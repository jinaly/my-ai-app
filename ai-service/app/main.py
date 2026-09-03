import os
import json
import ast
import operator
from pathlib import Path
from typing import Annotated, List, Literal
from typing_extensions import TypedDict
import traceback

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field
from app.rag_service import ingest_pdf_document, retrieve_relevant_context


# -----------------------------------------------------------------------------
# 1. Environment & Client Setup
# -----------------------------------------------------------------------------
APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent.parent

for candidate in [ROOT_DIR / ".env", APP_DIR.parent / ".env", APP_DIR / ".env"]:
    if candidate.is_file():
        load_dotenv(dotenv_path=candidate, override=True)
        break
else:
    load_dotenv()

API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
MODEL_ID = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

if not API_KEY:
    raise RuntimeError("Missing GOOGLE_API_KEY in environment.")

client = genai.Client(api_key=API_KEY)


# -----------------------------------------------------------------------------
# 2. Define Custom Tools (Python Functions)
# -----------------------------------------------------------------------------
# def get_current_weather(city: str) -> str:
#     """Get the current live weather and temperature for a given city."""
#     normalized = city.strip().lower()
#     if "ahmedabad" in normalized:
#         return json.dumps({"city": "Ahmedabad", "temperature": "32°C", "condition": "Sunny and Clear", "humidity": "45%"})
#     elif "mumbai" in normalized:
#         return json.dumps({"city": "Mumbai", "temperature": "30°C", "condition": "Humid / Partly Cloudy", "humidity": "78%"})
#     elif "london" in normalized:
#         return json.dumps({"city": "London", "temperature": "18°C", "condition": "Light Rain", "humidity": "82%"})
#     else:
#         return json.dumps({"city": city, "temperature": "25°C", "condition": "Clear Sky", "humidity": "50%"})


# # Tool mapping dictionary for easy execution
# TOOL_REGISTRY = {
#     "get_current_weather": get_current_weather
# }

def get_live_weather(city: str) -> str:
    """Fetch real-time weather data for a city including temperature, humidity,

    feels-like temperature, wind speed, and rain probability.

    Args:
        city: The name of the city (e.g. 'Ahmedabad', 'Mumbai', 'Delhi').
    """
    try:
        # 1. Geocoding request
        geo_res = httpx.get(
            f"https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1"
        ).json()
        if not geo_res.get("results"):
            return f"Could not find coordinates for {city}."

        lat = geo_res["results"][0]["latitude"]
        lon = geo_res["results"][0]["longitude"]

        # 2. Enhanced weather request with humidity & precipitation
        weather_url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m"
            f"&hourly=precipitation_probability"
            f"&timezone=auto"
        )
        weather_res = httpx.get(weather_url).json()

        current = weather_res.get("current", {})
        hourly = weather_res.get("hourly", {})

        temp = current.get("temperature_2m", "N/A")
        feels_like = current.get("apparent_temperature", "N/A")
        humidity = current.get("relative_humidity_2m", "N/A")
        wind = current.get("wind_speed_10m", "N/A")
        rain_prob = (
            hourly.get("precipitation_probability", [0])[0]
            if hourly.get("precipitation_probability")
            else 0
        )

        return (
            f"Live weather for {city}:\n"
            f"- Temperature: {temp}°C\n"
            f"- Feels Like: {feels_like}°C\n"
            f"- Relative Humidity: {humidity}%\n"
            f"- Wind Speed: {wind} km/h\n"
            f"- Rain Probability: {rain_prob}%\n"
        )
    except Exception as e:
        return f"Failed to retrieve weather: {str(e)}"
    
# -----------------------------------------------------------------------------
# 3. Tool 2: Safe AST Math Calculator
# -----------------------------------------------------------------------------
# Supported math operators for security (avoids dangerous eval())
ALLOWED_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
}

def _eval_ast(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in ALLOWED_OPS:
        return ALLOWED_OPS[type(node.op)](_eval_ast(node.left), _eval_ast(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in ALLOWED_OPS:
        return ALLOWED_OPS[type(node.op)](_eval_ast(node.operand))
    raise ValueError("Unsupported mathematical operator")

def calculate_expression(expression: str) -> str:
    """Safely calculate mathematical or financial arithmetic expressions like '32 * 0.15' or '(5000 * 0.08) / 12'."""
    try:
        clean_expr = expression.replace("^", "**").strip()
        parsed = ast.parse(clean_expr, mode="eval")
        result = _eval_ast(parsed.body)
        return json.dumps({"expression": expression, "result": result})
    except Exception as exc:
        return json.dumps({"error": f"Invalid math expression: {str(exc)}"})
    
def query_product_database(sku: str) -> str:
    """Search the inventory database for stock and pricing of a product by SKU."""
    # Run database logic or API call here
    return json.dumps({"sku": sku, "in_stock": True, "price": 49.99})

TOOL_REGISTRY = {
    "get_live_weather": get_live_weather,
    "calculate_expression": calculate_expression,
    "query_product_database":query_product_database
}

# -----------------------------------------------------------------------------
# 4. State Schema
# -----------------------------------------------------------------------------
class ChatState(TypedDict):
    messages: Annotated[List[dict], add_messages]
    tool_calls: List[dict]


def extract_message_info(msg):
    if hasattr(msg, "content"):
        content = msg.content
        role = "assistant" if msg.__class__.__name__.startswith("AI") else "user"
        return role, content
    return msg.get("role", "user"), msg.get("content", "")


# -----------------------------------------------------------------------------
# 5. Agent Node (Gemini with Tool Declaration)
# -----------------------------------------------------------------------------
def agent_node(state: ChatState) -> ChatState:
    formatted_contents = []
    
    for msg in state["messages"]:
        role, content = extract_message_info(msg)
        sdk_role = "user" if role == "user" else "model"
        formatted_contents.append(
            types.Content(
                role=sdk_role,
                parts=[types.Part.from_text(text=str(content))],
            )
        )

    # Pass Python tools to Gemini
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=formatted_contents,
        config=types.GenerateContentConfig(
            temperature=0.3,
            tools=[get_live_weather, calculate_expression,query_product_database],
            system_instruction="You are a helpful assistant with access to real-time tools. Use them whenever relevant.",
        ),
    )

    detected_tool_calls = []
    text_content = ""

    # Check if Gemini wants to call a tool
    if response.function_calls:
        for fc in response.function_calls:
            detected_tool_calls.append({
                "name": fc.name,
                "args": dict(fc.args),
            })
    else:
        text_content = response.text or ""

    ai_reply = {"role": "assistant", "content": text_content}

    return {
        "messages": [ai_reply],
        "tool_calls": detected_tool_calls
    }


# -----------------------------------------------------------------------------
# 6. Tool Node (Executes Python Functions)
# -----------------------------------------------------------------------------
def tool_node(state: ChatState) -> ChatState:
    tool_results = []
    
    for call in state.get("tool_calls", []):
        tool_name = call["name"]
        tool_args = call["args"]
        
        if tool_name in TOOL_REGISTRY:
            fn = TOOL_REGISTRY[tool_name]
            output = fn(**tool_args)
            tool_results.append(f"Tool [{tool_name}] output: {output}")

    # Inject tool output into conversation context as user/system observation
    tool_message = {
        "role": "user",
        "content": "Observation from tools:\n" + "\n".join(tool_results)
    }

    return {
        "messages": [tool_message],
        "tool_calls": []
    }


# -----------------------------------------------------------------------------
# 7. Conditional Edge Router
# -----------------------------------------------------------------------------
def should_continue(state: ChatState) -> Literal["tools", "__end__"]:
    # If agent requested a tool call, route to 'tools', otherwise finish
    if state.get("tool_calls"):
        return "tools"
    return END


# -----------------------------------------------------------------------------
# 8. Compile Graph with Cyclical Loop
# -----------------------------------------------------------------------------
builder = StateGraph(ChatState)

builder.add_node("agent", agent_node)
builder.add_node("tools", tool_node)

builder.set_entry_point("agent")

# Conditional routing from agent
builder.add_conditional_edges(
    "agent",
    should_continue,
    {
        "tools": "tools",
        END: END
    }
)

# Loop back to agent after tool completes
builder.add_edge("tools", "agent")

chat_executor = builder.compile()

AVAILABLE_TOOLS = {
    "get_live_weather": get_live_weather,
    "calculate_expression": calculate_expression,
    "query_product_database":query_product_database
}


# -------------------------------------------------------------------------------
# 10. Streming Support
# -------------------------------------------------------------------------------
def stream_agent_generator(messages_payload: list):
    try:
        formatted_contents = []
        for msg in messages_payload:
            # Safely extract role and content whether msg is a Pydantic object or a dict
            if hasattr(msg, "role") and hasattr(msg, "content"):
                role_val = "user" if msg.role == "user" else "model"
                content_val = str(msg.content)
            elif isinstance(msg, dict):
                role_val = "user" if msg.get("role") == "user" else "model"
                content_val = str(msg.get("content", ""))
            else:
                role_val = "user"
                content_val = str(msg)

            formatted_contents.append(
                types.Content(
                    role=role_val,
                    parts=[types.Part.from_text(text=content_val)],
                )
            )

        # --- INSERT RAG CONTEXT RETRIEVAL HERE ---
        last_message = messages_payload[-1] if messages_payload else {}
        query_text = (
            last_message.get("content", "")
            if isinstance(last_message, dict)
            else getattr(last_message, "content", str(last_message))
        )

        # Retrieve top semantic matches from ChromaDB
        document_context = retrieve_relevant_context(query_text, top_k=3)

        base_instructions = "You are a helpful assistant. Always call available tools when the user asks for real-time information such as weather."
        if document_context:
            system_instruction = (
                f"{base_instructions} Use the following retrieved document context to answer questions accurately. "
                f"If the answer is found in the context, cite facts directly from it.\n\n"
                f"[DOCUMENT CONTEXT]:\n{document_context}"
            )
        else:
            system_instruction = base_instructions
        # ----------------------------------------

        # Configure system instructions and tools
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            tools=list(AVAILABLE_TOOLS.values()),
            temperature=0.2,
        )

        # 1. First pass: check if a tool call is needed
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=formatted_contents,
            config=config,
        )

        # 2. Check if a function call was requested
        if response.function_calls:
            for call in response.function_calls:
                tool_name = call.name
                tool_args = dict(call.args) if call.args else {}

                city_name = tool_args.get("city", "the requested city")
                yield f"data: {json.dumps({'type': 'status', 'message': f'⚡ Checking live weather for {city_name}...'})}\n\n"

                tool_func = AVAILABLE_TOOLS.get(tool_name)
                tool_result = (
                    tool_func(**tool_args) if tool_func else "Tool not found"
                )

                # Append model candidate turn
                formatted_contents.append(response.candidates[0].content)

                # Append tool execution result turn
                formatted_contents.append(
                    types.Content(
                        role="tool",
                        parts=[
                            types.Part.from_function_response(
                                name=tool_name,
                                response={"result": str(tool_result)},
                            )
                        ],
                    )
                )

        # 3. Stream final synthesized response
        stream_response = client.models.generate_content_stream(
            model=MODEL_ID,
            contents=formatted_contents,
            config=config,
        )

        for chunk in stream_response:
            if chunk.text:
                yield f"data: {json.dumps({'type': 'token', 'token': chunk.text})}\n\n"

        yield "data: [DONE]\n\n"

    except Exception as exc:
        traceback.print_exc()
        yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
# -----------------------------------------------------------------------------
# 9. FastAPI API Endpoint
# -----------------------------------------------------------------------------
app = FastAPI(title="AI Service Engine - Agentic Tools")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class MessageItem(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., min_length=1)


class ChatRequest(BaseModel):
    messages: List[MessageItem]


class ChatResponse(BaseModel):
    response: str


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ai-service", "tools_enabled": True}


@app.post("/api/chat", response_model=ChatResponse)
async def handle_chat(payload: ChatRequest):
    try:
        initial_state = {
            "messages": [msg.model_dump() for msg in payload.messages],
            "tool_calls": []
        }
        result = chat_executor.invoke(initial_state)

        last_msg = result["messages"][-1]
        _, text_content = extract_message_info(last_msg)

        return ChatResponse(response=text_content)
    except Exception as exc:
        print("❌ Agent Execution Error:", str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"LangGraph tool loop failed: {str(exc)}",
        )
    

@app.post("/api/chat/stream")
def chat_stream_endpoint(payload: ChatRequest):
    return StreamingResponse(
        stream_agent_generator(payload.messages),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/api/documents/upload")
async def upload_pdf(
    file: UploadFile = File(...), session_id: str = Form("default")
):
    file_bytes = await file.read()
    result = ingest_pdf_document(
        file_bytes, file.filename, session_id=session_id
    )
    return result

@app.get("/api/documents")
async def list_documents():
    """Returns a list of unique uploaded document filenames stored in ChromaDB."""
    from app.rag_service import collection

    data = collection.get(include=["metadatas"])
    metadatas = data.get("metadatas", [])
    unique_files = list(
        {m.get("source") for m in metadatas if m and "source" in m}
    )
    return {"documents": unique_files, "total_chunks": len(metadatas)}


@app.delete("/api/sessions/{session_id}/cleanup")
async def cleanup_session_vectors(session_id: str):
    from app.rag_service import collection

    # Deletes all vector embeddings associated with this chat
    collection.delete(where={"session_id": session_id})
    return {
        "status": "success",
        "message": f"Purged vectors for session {session_id}",
    }
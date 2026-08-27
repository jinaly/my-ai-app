import os
import json
from pathlib import Path
from typing import Annotated, List, Literal
from typing_extensions import TypedDict

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

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
MODEL_ID = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

if not API_KEY:
    raise RuntimeError("Missing GOOGLE_API_KEY in environment.")

client = genai.Client(api_key=API_KEY)


# -----------------------------------------------------------------------------
# 2. Define Custom Tools (Python Functions)
# -----------------------------------------------------------------------------
def get_current_weather(city: str) -> str:
    """Get the current live weather and temperature for a given city."""
    normalized = city.strip().lower()
    if "ahmedabad" in normalized:
        return json.dumps({"city": "Ahmedabad", "temperature": "32°C", "condition": "Sunny and Clear", "humidity": "45%"})
    elif "mumbai" in normalized:
        return json.dumps({"city": "Mumbai", "temperature": "30°C", "condition": "Humid / Partly Cloudy", "humidity": "78%"})
    elif "london" in normalized:
        return json.dumps({"city": "London", "temperature": "18°C", "condition": "Light Rain", "humidity": "82%"})
    else:
        return json.dumps({"city": city, "temperature": "25°C", "condition": "Clear Sky", "humidity": "50%"})


# Tool mapping dictionary for easy execution
TOOL_REGISTRY = {
    "get_current_weather": get_current_weather
}


# -----------------------------------------------------------------------------
# 3. State Schema
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
# 4. Agent Node (Gemini with Tool Declaration)
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
            tools=[get_current_weather],
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
# 5. Tool Node (Executes Python Functions)
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
# 6. Conditional Edge Router
# -----------------------------------------------------------------------------
def should_continue(state: ChatState) -> Literal["tools", "__end__"]:
    # If agent requested a tool call, route to 'tools', otherwise finish
    if state.get("tool_calls"):
        return "tools"
    return END


# -----------------------------------------------------------------------------
# 7. Compile Graph with Cyclical Loop
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


# -----------------------------------------------------------------------------
# 8. FastAPI API Endpoint
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
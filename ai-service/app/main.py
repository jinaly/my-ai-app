import os
from pathlib import Path
from typing import Annotated, List
from typing_extensions import TypedDict

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field


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


class ChatState(TypedDict):
    messages: Annotated[List[dict], add_messages]


def extract_message_info(msg):
    if hasattr(msg, "content"):
        content = msg.content
        role = "assistant" if msg.__class__.__name__.startswith("AI") else "user"
        return role, content
    return msg.get("role", "user"), msg.get("content", "")


def chat_node(state: ChatState) -> ChatState:
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

    response = client.models.generate_content(
        model=MODEL_ID,
        contents=formatted_contents,
        config=types.GenerateContentConfig(
            temperature=0.7,
            system_instruction="You are a helpful AI engineering assistant.",
        ),
    )

    ai_reply = {"role": "assistant", "content": response.text or ""}
    return {"messages": [ai_reply]}


builder = StateGraph(ChatState)
builder.add_node("chat", chat_node)
builder.set_entry_point("chat")
builder.add_edge("chat", END)
chat_executor = builder.compile()

app = FastAPI(title="AI Service Engine")

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
    return {"status": "healthy", "service": "ai-service", "memory": True}


@app.post("/api/chat", response_model=ChatResponse)
async def handle_chat(payload: ChatRequest):
    try:
        initial_state = {
            "messages": [msg.model_dump() for msg in payload.messages]
        }
        result = chat_executor.invoke(initial_state)

        last_msg = result["messages"][-1]
        _, text_content = extract_message_info(last_msg)

        return ChatResponse(response=text_content)
    except Exception as exc:
        print("❌ LangGraph Error:", str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"LangGraph execution failed: {str(exc)}",
        )
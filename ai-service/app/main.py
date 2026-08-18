import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TypedDict

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent         
SERVICE_DIR = APP_DIR.parent                     
MONOREPO_ROOT = SERVICE_DIR.parent                

for env_candidate in [
    SERVICE_DIR / ".env",
    MONOREPO_ROOT / ".env",
    APP_DIR / ".env",
    Path(".env").resolve(),
]:
    if env_candidate.is_file():
        load_dotenv(dotenv_path=env_candidate, override=True)
        break
else:
    load_dotenv()

API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
MODEL_ID = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

if not API_KEY:
    raise RuntimeError(
        f"Missing API key! Checked paths including {MONOREPO_ROOT / '.env'}"
    )

client = genai.Client(api_key=API_KEY)

class AgentState(TypedDict):
    input_text: str
    response_text: str


def generate_node(state: AgentState) -> AgentState:
    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=state["input_text"],
            config=types.GenerateContentConfig(
                temperature=0.7,
                system_instruction="You are a senior AI assistant delivering concise, accurate, production-grade solutions.",
            ),
        )
        return {"response_text": response.text or ""}
    except Exception as exc:
        raise RuntimeError(f"LLM Generation failed: {str(exc)}") from exc


def build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("generate", generate_node)
    builder.set_entry_point("generate")
    builder.add_edge("generate", END)
    return builder.compile()


agent_executor = build_graph()

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"🚀 [AI-Service] Bootstrapping with Gemini ({MODEL_ID})...")
    yield


app = FastAPI(
    title="AI Orchestration Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=10000, description="User prompt")


class QueryResponse(BaseModel):
    response: str
    model: str = MODEL_ID


@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {
        "status": "healthy",
        "service": "ai-service",
        "sdk": "google-genai",
        "model": MODEL_ID,
    }


@app.post("/api/generate", response_model=QueryResponse, status_code=status.HTTP_200_OK)
async def generate_response(payload: QueryRequest):
    try:
        result = agent_executor.invoke({"input_text": payload.prompt})
        return QueryResponse(response=result["response_text"])
    except RuntimeError as r_err:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(r_err),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal pipeline failure: {str(exc)}",
        )
import io
import os
import uuid
import chromadb
from dotenv import load_dotenv
from google import genai
from pypdf import PdfReader

load_dotenv()

api_key =  os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY is not set. Check your ai-service/.env file.")

client = genai.Client(api_key=api_key)
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(name="documents")
EMBEDDING_MODEL = "gemini-embedding-001"


def extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    if filename.lower().endswith(".txt"):
        return file_bytes.decode("utf-8", errors="ignore")
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        pages = [p.extract_text() for p in reader.pages if p.extract_text()]
        return "\n".join(pages)
    except Exception as e:
        print(f"Error parsing {filename}: {e}")
        return ""


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    chunks = []
    start = 0
    clean = text.strip()
    while start < len(clean):
        end = start + chunk_size
        seg = clean[start:end].strip()
        if seg:
            chunks.append(seg)
        start += chunk_size - overlap
    return chunks


def ingest_pdf_document(
    file_bytes: bytes, filename: str, session_id: str = "default"
) -> dict:
    raw_text = extract_text_from_file(file_bytes, filename)
    if not raw_text.strip():
        return {
            "status": "error",
            "message": f"No readable text found in {filename}.",
        }

    chunks = chunk_text(raw_text)
    if not chunks:
        return {"status": "error", "message": "Failed to extract chunks."}

    embed_response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=chunks,
    )
    embeddings = [e.values for e in embed_response.embeddings]

    ids = [f"{session_id}_{filename}_{uuid.uuid4().hex[:8]}" for _ in chunks]
    metadatas = [
        {"source": filename, "session_id": session_id, "chunk_index": i}
        for i in range(len(chunks))
    ]

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=metadatas,
    )

    return {
        "status": "success",
        "filename": filename,
        "total_chunks": len(chunks),
    }


def retrieve_relevant_context(
    query: str, session_id: str = "default", top_k: int = 3
) -> str:
    if collection.count() == 0:
        return ""

    query_embed = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=[query],
    )
    query_vector = query_embed.embeddings[0].values

    # Restrict retrieval strictly to documents attached in this session
    results = collection.query(
        query_embeddings=[query_vector],
        n_results=min(top_k, collection.count()),
        where={"session_id": session_id},
    )

    retrieved_docs = results.get("documents", [[]])[0]
    return "\n\n---\n\n".join(retrieved_docs)
import { useState } from "react";

function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setResponse("");

    try {
      const res = await fetch("http://localhost:5001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();
      if (data.data) {
        setResponse(data.data);
      } else {
        setResponse("Error: " + (data.error || "Something went wrong"));
      }
    } catch (err) {
      setResponse("Connection error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: "700px",
        margin: "40px auto",
        fontFamily: "sans-serif",
        padding: "20px",
      }}
    >
      <h2>GenAI Full-Stack Starter</h2>
      <p style={{ color: "#666" }}>
        React &rarr; Express Gateway &rarr; FastAPI (LangGraph)
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "10px", marginTop: "20px" }}
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask something..."
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 20px",
            borderRadius: "6px",
            background: "#0070f3",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          {loading ? "Thinking..." : "Send"}
        </button>
      </form>

      {response && (
        <div
          style={{
            marginTop: "25px",
            padding: "15px",
            background: "#f5f5f5",
            borderRadius: "8px",
            whiteSpace: "pre-wrap",
          }}
        >
          <strong>Response:</strong>
          <p>{response}</p>
        </div>
      )}
    </div>
  );
}

export default App;

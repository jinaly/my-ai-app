import { useState, useRef, useEffect } from "react";

export default function App() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hello! How can I help you today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to latest message
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    // 1. Append user message to local state
    const userMessage = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      // 2. Send the ENTIRE message history to Express gateway
      const res = await fetch("http://localhost:5001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      const data = await res.json();

      if (data.data) {
        // 3. Append assistant response to state
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.data },
        ]);
      } else {
        throw new Error(data.error || "No response from server");
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: "680px",
        margin: "40px auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h2 style={{ marginBottom: "16px", color: "#0f172a" }}>
        AI Chat Assistant
      </h2>

      {/* Chat Window */}
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: "10px",
          height: "480px",
          overflowY: "auto",
          padding: "16px",
          backgroundColor: "#f8fafc",
        }}
      >
        {messages.map((msg, idx) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  maxWidth: "75%",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  background: isUser ? "#2563eb" : "#ffffff",
                  color: isUser ? "#ffffff" : "#0f172a",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.5",
                }}
              >
                {msg.content}
              </div>
            </div>
          );
        })}

        {loading && (
          <div
            style={{
              color: "#64748b",
              fontStyle: "italic",
              fontSize: "14px",
              marginTop: "8px",
            }}
          >
            AI is thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", marginTop: "12px", gap: "8px" }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            outline: "none",
            fontSize: "15px",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 20px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "#2563eb",
            color: "#ffffff",
            fontWeight: "500",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from "react";
import ChatMessage from "./components/ChatMessage";
import Sidebar from "./components/Sidebar";

const createNewSessionId = () =>
  "sess_" + Math.random().toString(36).substring(2, 9) + Date.now();

export default function App() {
  const [sessionId, setSessionId] = useState(() => {
    return localStorage.getItem("ai_session_id") || createNewSessionId();
  });
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const abortControllerRef = useRef(null);
  const currentSessionRef = useRef(sessionId);
  const messagesEndRef = useRef(null);

  // Sync ref with state
  useEffect(() => {
    currentSessionRef.current = sessionId;
    localStorage.setItem("ai_session_id", sessionId);
  }, [sessionId]);

  // Fetch all sessions for the sidebar
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:5001/api/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error("Failed to load session list:", err);
    }
  }, []);

  // Fetch conversation messages when sessionId changes
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch(
          `http://localhost:5001/api/chat/history/${sessionId}`
        );
        if (!res.ok) return;

        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages);
        } else {
          setMessages([
            {
              role: "assistant",
              content: "Hello! Ask me anything to start chatting.",
            },
          ]);
        }
      } catch (err) {
        console.log(err);
        setMessages([
          {
            role: "assistant",
            content: "Hello! Ask me anything to start chatting.",
          },
        ]);
      }
    }

    loadHistory();
    fetchSessions();
  }, [sessionId, fetchSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Switching sessions
  const handleSelectSession = (newId) => {
    if (newId === sessionId) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setSessionId(newId);
  };

  // Creating a new session
  const handleNewChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    const newId = createNewSessionId();
    setSessionId(newId);
    setMessages([
      {
        role: "assistant",
        content: "Hello! Ask me anything to start chatting.",
      },
    ]);
  };

  // Deleting a session
  const handleDeleteSession = async (targetId) => {
    try {
      await fetch(`http://localhost:5001/api/sessions/${targetId}`, {
        method: "DELETE",
      });
      if (targetId === sessionId) {
        handleNewChat();
      } else {
        fetchSessions();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    // Set up abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const targetSessionId = sessionId;
    const userPrompt = input.trim();
    const updatedMessages = [
      ...messages,
      { role: "user", content: userPrompt },
    ];

    setMessages([...updatedMessages, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("http://localhost:5001/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: targetSessionId,
          prompt: userPrompt,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let streamedText = "";
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.replace(/^data:\s*/, "");
          if (dataStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.token) {
              streamedText += parsed.token;

              // Only update UI if user hasn't navigated away to a different session
              if (currentSessionRef.current === targetSessionId) {
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = {
                    role: "assistant",
                    content: streamedText,
                  };
                  return next;
                });
              }
            }
          } catch (err) {
            console.log(err);
            // Ignore incomplete JSON buffers
          }
        }
      }

      // Refresh sidebar titles after full response finishes
      fetchSessions();
    } catch (err) {
      if (err.name !== "AbortError") {
        if (currentSessionRef.current === targetSessionId) {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: `⚠️ Error: ${err.message}`,
            };
            return next;
          });
        }
      }
    } finally {
      if (currentSessionRef.current === targetSessionId) {
        setLoading(false);
      }
      abortControllerRef.current = null;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <Sidebar
        sessions={sessions}
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
      />

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#f8fafc",
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
            maxWidth: "800px",
            width: "100%",
            margin: "0 auto",
            boxSizing: "border-box",
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
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: isUser ? "10px 14px" : "14px 18px",
                    borderRadius: "12px",
                    background: isUser ? "#2563eb" : "#ffffff",
                    color: isUser ? "#ffffff" : "#0f172a",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  }}
                >
                  {isUser ? (
                    <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                  ) : msg.content ? (
                    <ChatMessage content={msg.content} />
                  ) : (
                    loading && idx === messages.length - 1 && <span>● ● ●</span>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div
          style={{
            padding: "16px 24px",
            maxWidth: "800px",
            width: "100%",
            margin: "0 auto",
            boxSizing: "border-box",
          }}
        >
          <form onSubmit={handleSubmit} style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything..."
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "15px",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "12px 24px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#2563eb",
                color: "#ffffff",
                fontWeight: "600",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "..." : "Send"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

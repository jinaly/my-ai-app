export default function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
}) {
  return (
    <aside
      style={{
        width: "260px",
        backgroundColor: "#0f172a",
        color: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        borderRight: "1px solid #1e293b",
        padding: "16px 12px",
        boxSizing: "border-box",
      }}
    >
      <button
        onClick={onNewChat}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "10px 14px",
          backgroundColor: "#2563eb",
          color: "#ffffff",
          border: "none",
          borderRadius: "8px",
          fontWeight: "600",
          cursor: "pointer",
          marginBottom: "16px",
        }}
      >
        <span>+</span> New Chat
      </button>

      <div
        style={{
          fontSize: "12px",
          color: "#64748b",
          padding: "0 8px 8px",
          fontWeight: "bold",
        }}
      >
        RECENT CHATS
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        {sessions.map((sess) => {
          const isActive = sess.sessionId === currentSessionId;
          return (
            <div
              key={sess.sessionId}
              onClick={() => onSelectSession(sess.sessionId)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: "6px",
                backgroundColor: isActive ? "#1e293b" : "transparent",
                cursor: "pointer",
                color: isActive ? "#38bdf8" : "#cbd5e1",
                fontSize: "14px",
                transition: "background 0.2s",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "170px",
                }}
              >
                {sess.title || "Conversation"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(sess.sessionId);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
                title="Delete session"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

import { useState, useRef } from "react";
import { Paperclip, Send, X, FileText, Loader2 } from "lucide-react";

export default function ChatInputBar({ onSendMessage, loading, sessionId }) {
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("session_id", sessionId);

    try {
      const res = await fetch("http://localhost:8000/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.status === "success") {
        setAttachedFile({
          name: file.name,
          chunks: data.total_chunks,
        });
      } else {
        alert(data.message || "Failed to upload document.");
      }
    } catch (err) {
      console.error(err);
      alert("Network error while uploading document.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemoveAttachment = () => {
    setAttachedFile(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if ((!input.trim() && !attachedFile) || loading || uploading) return;

    onSendMessage({
      prompt: input.trim(),
      attachedFile: attachedFile ? attachedFile.name : null,
    });

    setInput("");
    setAttachedFile(null);
  };

  return (
    <div
      style={{
        padding: "16px 24px",
        maxWidth: "800px",
        width: "100%",
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          backgroundColor: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          padding: "10px 14px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        }}
      >
        {/* Attachment Staging Chips */}
        {uploading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              color: "#64748b",
              background: "#f1f5f9",
              padding: "4px 10px",
              borderRadius: "6px",
              alignSelf: "flex-start",
            }}
          >
            <Loader2 className="animate-spin" size={14} color="#2563eb" />
            <span>Indexing document into memory...</span>
          </div>
        )}

        {attachedFile && !uploading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              color: "#1e3a8a",
              background: "#dbeafe",
              padding: "4px 10px",
              borderRadius: "6px",
              alignSelf: "flex-start",
              border: "1px solid #bfdbfe",
            }}
          >
            <FileText size={15} color="#2563eb" />
            <span
              style={{
                maxWidth: "240px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: 500,
              }}
            >
              {attachedFile.name}
            </span>
            <button
              type="button"
              onClick={handleRemoveAttachment}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
                color: "#64748b",
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".pdf,.txt"
            style={{ display: "none" }}
          />

          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            title="Attach PDF or TXT"
            style={{
              background: "transparent",
              border: "none",
              cursor: uploading ? "not-allowed" : "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              color: "#64748b",
              borderRadius: "6px",
            }}
          >
            <Paperclip size={18} />
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              attachedFile
                ? "Ask a question about this file..."
                : "Ask anything..."
            }
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: "15px",
              background: "transparent",
              color: "#0f172a",
            }}
          />

          <button
            type="submit"
            disabled={loading || uploading || (!input.trim() && !attachedFile)}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#2563eb",
              color: "#ffffff",
              fontWeight: "600",
              cursor:
                loading || uploading || (!input.trim() && !attachedFile)
                  ? "not-allowed"
                  : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              opacity:
                loading || uploading || (!input.trim() && !attachedFile)
                  ? 0.5
                  : 1,
            }}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

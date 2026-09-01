import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

function CodeBlock({ inline, className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const codeString = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!inline && match) {
    return (
      <div
        style={{
          position: "relative",
          margin: "12px 0",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "#1e293b",
            padding: "4px 12px",
            fontSize: "12px",
            color: "#94a3b8",
          }}
        >
          <span>{match[1]}</span>
          <button
            onClick={handleCopy}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          PreTag="div"
          customStyle={{ margin: 0, padding: "12px", fontSize: "13px" }}
          {...props}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code
      style={{
        backgroundColor: "#e2e8f0",
        color: "#0f172a",
        padding: "2px 6px",
        borderRadius: "4px",
        fontSize: "13px",
        fontFamily: "monospace",
      }}
      {...props}
    >
      {children}
    </code>
  );
}

export default function ChatMessage({ content }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
          // eslint-disable-next-line no-unused-vars
          table: ({ node, ...props }) => (
            <div style={{ overflowX: "auto", margin: "12px 0" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  fontSize: "14px",
                }}
                {...props}
              />
            </div>
          ),
          // eslint-disable-next-line no-unused-vars
          th: ({ node, ...props }) => (
            <th
              style={{
                border: "1px solid #cbd5e1",
                padding: "6px 10px",
                background: "#f1f5f9",
                textAlign: "left",
              }}
              {...props}
            />
          ),
          // eslint-disable-next-line no-unused-vars
          td: ({ node, ...props }) => (
            <td
              style={{ border: "1px solid #cbd5e1", padding: "6px 10px" }}
              {...props}
            />
          ),
          // eslint-disable-next-line no-unused-vars
          p: ({ node, ...props }) => (
            <p style={{ margin: "6px 0", lineHeight: "1.6" }} {...props} />
          ),
          // eslint-disable-next-line no-unused-vars
          ul: ({ node, ...props }) => (
            <ul style={{ paddingLeft: "20px", margin: "6px 0" }} {...props} />
          ),
          // eslint-disable-next-line no-unused-vars
          ol: ({ node, ...props }) => (
            <ol style={{ paddingLeft: "20px", margin: "6px 0" }} {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

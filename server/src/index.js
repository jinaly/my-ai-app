const express = require("express");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
const ChatSession = require("./models/Chat");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/ai_chat_app";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Connect to MongoDB"))
  .catch((err) => console.log(err));

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "server-gateway" });
});

// Add or update this route in server/src/index.js
app.post("/api/chat", async (req, res) => {
  const { messages, prompt } = req.body;

  // Handles both full conversation array and legacy single prompt
  const payloadMessages = messages || [{ role: "user", content: prompt }];

  try {
    const aiResponse = await axios.post(`${AI_SERVICE_URL}/api/chat`, {
      messages: payloadMessages,
    });

    res.json({ data: aiResponse.data.response });
  } catch (error) {
    console.error(
      "AI Service Gateway Error:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Failed to process AI chat query",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/api/chat/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await ChatSession.findOne({ sessionId });
    return res.json({
      messages: session && session.messages ? session.messages : [],
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Failed to fetch history", details: err.message });
  }
});

// Add this route in server/src/index.js
app.post("/api/chat/stream", async (req, res) => {
  const { sessionId, prompt } = req.body;

  if (!sessionId || !prompt) {
    return res.status(400).json({ error: "sessionId and prompt are required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    // 1. Find or create session
    let session = await ChatSession.findOne({ sessionId });
    if (!session) {
      session = new ChatSession({ sessionId, messages: [] });
    }

    // 2. Safe check: ensure messages array is defined
    if (!Array.isArray(session.messages)) {
      session.messages = [];
    }

    // 3. Push user prompt
    session.messages.push({ role: "user", content: prompt });
    await session.save();

    // 4. Format messages for FastAPI
    const formattedMessages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 5. Connect to FastAPI streaming endpoint
    const response = await axios({
      method: "post",
      url: `${AI_SERVICE_URL}/api/chat/stream`,
      data: { messages: formattedMessages },
      responseType: "stream",
    });

    let fullAssistantResponse = "";

    response.data.on("data", (chunk) => {
      const text = chunk.toString();
      res.write(text);

      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:") && !trimmed.includes("[DONE]")) {
          try {
            const parsed = JSON.parse(trimmed.replace(/^data:\s*/, ""));
            if (parsed.token) fullAssistantResponse += parsed.token;
          } catch (e) {}
        }
      }
    });

    response.data.on("end", async () => {
      if (fullAssistantResponse.trim()) {
        await ChatSession.updateOne(
          { sessionId },
          {
            $push: {
              messages: { role: "assistant", content: fullAssistantResponse },
            },
            $set: { updatedAt: new Date() },
          }
        );
      }
      res.end();
    });

    response.data.on("error", (err) => {
      console.error("FastAPI Stream Error:", err.message);
      res.end();
    });
  } catch (error) {
    console.error("Express Stream Error:", error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// 1. Fetch chat history for a session
app.get("/api/chat/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await ChatSession.findOne({ sessionId });

    // Return empty array if session is new
    return res.json({ messages: session ? session.messages : [] });
  } catch (err) {
    console.error("History Fetch Error:", err.message);
    return res
      .status(500)
      .json({ error: "Failed to fetch history", details: err.message });
  }
});

// 1. Get all chat sessions (sorted by most recent)
app.get("/api/sessions", async (req, res) => {
  try {
    const sessions = await ChatSession.find({}, "sessionId messages updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    // Extract a preview title from the first user message
    const formattedSessions = sessions.map((s) => {
      const firstUserMsg = s.messages?.find((m) => m.role === "user");
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 30) + "..."
        : "New Chat";
      return {
        sessionId: s.sessionId,
        title,
        updatedAt: s.updatedAt,
      };
    });

    res.json({ sessions: formattedSessions });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch sessions", details: err.message });
  }
});

// 2. Delete a chat session
app.delete("/api/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    await ChatSession.deleteOne({ sessionId });
    res.json({ success: true, message: "Session deleted" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to delete session", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(` Gateway running on port ${PORT}`);
});
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server Gateway running on http://localhost:${PORT}`);
});

// Explicit keep-alive
setInterval(() => {}, 1 << 30);

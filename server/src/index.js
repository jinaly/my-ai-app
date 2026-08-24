const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

app.use(cors());
app.use(express.json());

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

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server Gateway running on http://localhost:${PORT}`);
});

// Explicit keep-alive
setInterval(() => {}, 1 << 30);

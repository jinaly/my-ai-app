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

app.post("/api/chat", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const aiResponse = await axios.post(`${AI_SERVICE_URL}/api/generate`, {
      prompt,
    });

    res.json({ data: aiResponse.data.response });
  } catch (error) {
    console.error("AI Service Error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to process AI query",
      details: error.response?.data || error.message,
    });
  }
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server Gateway running on http://localhost:${PORT}`);
});

// Explicit keep-alive
setInterval(() => {}, 1 << 30);

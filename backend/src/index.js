require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const serverlessHttp = require("serverless-http");
const { createChatChain } = require("./chains/chat");

// Feedback store — DynamoDB in production, JSON file fallback for local dev
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE;
const FEEDBACK_FILE = path.join(__dirname, "../data/feedback.json");

let dynamo = null;
if (FEEDBACK_TABLE) {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
  dynamo = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" })
  );
}

// --- DynamoDB helpers ---
async function dbPutFeedback(item) {
  const { PutCommand } = require("@aws-sdk/lib-dynamodb");
  await dynamo.send(new PutCommand({ TableName: FEEDBACK_TABLE, Item: item }));
}

async function dbGetFeedback(id) {
  const { GetCommand } = require("@aws-sdk/lib-dynamodb");
  const result = await dynamo.send(
    new GetCommand({ TableName: FEEDBACK_TABLE, Key: { id } })
  );
  return result.Item || null;
}

async function dbScanFeedback(status) {
  const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
  const params = { TableName: FEEDBACK_TABLE };
  if (status) {
    params.FilterExpression = "#s = :s";
    params.ExpressionAttributeNames = { "#s": "status" };
    params.ExpressionAttributeValues = { ":s": status };
  }
  const result = await dynamo.send(new ScanCommand(params));
  return result.Items || [];
}

async function dbUpdateFeedback(id, updates) {
  const { UpdateCommand } = require("@aws-sdk/lib-dynamodb");
  const entries = Object.entries(updates);
  const expression = entries.map((_, i) => `#k${i} = :v${i}`).join(", ");
  const names = Object.fromEntries(entries.map(([k], i) => [`#k${i}`, k]));
  const values = Object.fromEntries(entries.map(([, v], i) => [`:v${i}`, v]));
  const result = await dynamo.send(
    new UpdateCommand({
      TableName: FEEDBACK_TABLE,
      Key: { id },
      UpdateExpression: `SET ${expression}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    })
  );
  return result.Attributes;
}

async function dbDeleteFeedback(id) {
  const { DeleteCommand } = require("@aws-sdk/lib-dynamodb");
  await dynamo.send(
    new DeleteCommand({ TableName: FEEDBACK_TABLE, Key: { id } })
  );
}

// --- Local JSON fallback helpers ---
function loadFeedback() {
  try {
    fs.mkdirSync(path.dirname(FEEDBACK_FILE), { recursive: true });
    if (fs.existsSync(FEEDBACK_FILE)) {
      return JSON.parse(fs.readFileSync(FEEDBACK_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

function saveFeedback(feedback) {
  fs.mkdirSync(path.dirname(FEEDBACK_FILE), { recursive: true });
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback, null, 2));
}

const app = express();

// CORS — only allow requests from stevenpinto.com
const allowedOrigins = [
  "https://stevenpinto.com",
  "https://www.stevenpinto.com",
  "https://new.stevenpinto.com",
];
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:3000", "http://localhost:3001", "http://localhost:5000");
}
app.use(cors({ origin: allowedOrigins }));

// Rate limiting — 10 requests per minute per IP on chat endpoints
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests. Please wait a moment and try again." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.headers["x-forwarded-for"] || "unknown",
});

app.use(express.json());

// In-memory session store (replaced by DynamoDB in production)
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [] });
  }
  return sessions.get(sessionId);
}

function formatHistory(history) {
  if (history.length === 0) return "No previous conversation.";
  return history
    .map((msg) => `${msg.role === "user" ? "User" : "Steve AI"}: ${msg.content}`)
    .join("\n");
}

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Streaming chat handler (shared by public and private)
async function handleStreamingChat(req, res, mode) {
  try {
    const { message, sessionId } = req.body;
    const maxLen = mode === "private" ? 5000 : 2000;
    const maxHistory = mode === "private" ? 40 : 20;
    const sid = sessionId || (mode === "private" ? "private-default" : "anonymous");

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (message.length > maxLen) {
      return res.status(400).json({ error: `Message too long (max ${maxLen} characters)` });
    }

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    const session = getSession(sid);
    const chain = await createChatChain(mode);

    // Stream the response
    let fullResponse = "";
    const stream = await chain.stream({
      question: message.trim(),
      history: formatHistory(session.history),
    });

    for await (const chunk of stream) {
      fullResponse += chunk;
      // Send each chunk as an SSE event
      res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
    }

    // Send done event
    res.write(`data: ${JSON.stringify({ done: true, sessionId: sid })}\n\n`);
    res.end();

    // Update session history after stream completes
    session.history.push({ role: "user", content: message.trim() });
    session.history.push({ role: "assistant", content: fullResponse });
    if (session.history.length > maxHistory) {
      session.history = session.history.slice(-maxHistory);
    }
  } catch (error) {
    console.error(`${mode} chat error:`, error);
    // If headers already sent, send error as SSE
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "Something went wrong." })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  }
}

// Public chat endpoint (streaming)
app.post("/api/chat/public", chatLimiter, (req, res) => handleStreamingChat(req, res, "public"));

// Private chat endpoint (streaming)
app.post("/api/chat/private", chatLimiter, (req, res) => handleStreamingChat(req, res, "private"));

// Submit feedback (thumbs up/down from widget)
app.post("/api/feedback", async (req, res) => {
  try {
    const { question, response, rating, comment, sessionId } = req.body;

    if (!question || !response || !rating) {
      return res.status(400).json({ error: "question, response, and rating are required" });
    }

    if (!["up", "down"].includes(rating)) {
      return res.status(400).json({ error: "rating must be 'up' or 'down'" });
    }

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      question: question.substring(0, 2000),
      response: response.substring(0, 5000),
      rating,
      comment: (comment || "").substring(0, 1000),
      sessionId: sessionId || "anonymous",
      timestamp: new Date().toISOString(),
      status: "pending",
    };

    if (dynamo) {
      await dbPutFeedback(item);
    } else {
      const feedback = loadFeedback();
      feedback.push(item);
      saveFeedback(feedback);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Feedback error:", error);
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

// Get all feedback (admin endpoint)
app.get("/api/feedback", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const status = req.query.status;
    let items;
    if (dynamo) {
      items = await dbScanFeedback(status);
    } else {
      const feedback = loadFeedback();
      items = status ? feedback.filter((f) => f.status === status) : feedback;
    }

    items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)); // newest first
    res.json(items);
  } catch (error) {
    console.error("Feedback fetch error:", error);
    res.status(500).json({ error: "Failed to load feedback" });
  }
});

// Update feedback status (admin: approve or dismiss)
app.patch("/api/feedback/:id", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { status } = req.body;
    if (!["approved", "dismissed", "pending"].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved', 'dismissed', or 'pending'" });
    }

    const updates = { status, reviewedAt: new Date().toISOString() };

    if (dynamo) {
      const existing = await dbGetFeedback(req.params.id);
      if (!existing) return res.status(404).json({ error: "Feedback not found" });
      const updated = await dbUpdateFeedback(req.params.id, updates);
      return res.json(updated);
    } else {
      const feedback = loadFeedback();
      const item = feedback.find((f) => f.id === req.params.id);
      if (!item) return res.status(404).json({ error: "Feedback not found" });
      Object.assign(item, updates);
      saveFeedback(feedback);
      return res.json(item);
    }
  } catch (error) {
    console.error("Feedback update error:", error);
    res.status(500).json({ error: "Failed to update feedback" });
  }
});

// Delete feedback (admin)
app.delete("/api/feedback/:id", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (dynamo) {
      const existing = await dbGetFeedback(req.params.id);
      if (!existing) return res.status(404).json({ error: "Feedback not found" });
      await dbDeleteFeedback(req.params.id);
    } else {
      let feedback = loadFeedback();
      const before = feedback.length;
      feedback = feedback.filter((f) => f.id !== req.params.id);
      if (feedback.length === before) {
        return res.status(404).json({ error: "Feedback not found" });
      }
      saveFeedback(feedback);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Feedback delete error:", error);
    res.status(500).json({ error: "Failed to delete feedback" });
  }
});

// Local development server (skip when loaded via local-runner.js)
if (process.env.NODE_ENV !== "production" && !process.env.USE_LOCAL_RUNNER) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Steve AI backend running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

// Lambda handler export
module.exports.handler = serverlessHttp(app);
module.exports.app = app;

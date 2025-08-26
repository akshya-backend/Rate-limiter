import express from "express";
import Redis from "ioredis";
import RateLimiter from "./limiter.js";

const app = express();
const redis = new Redis({
  host: "127.0.0.1",
  port: 6379,
});

// Create limiter: 5 requests per 30 seconds for /limited
const limiter = new RateLimiter({
  redis,
  maxTokens: 5,
  refillWindow: 30,
  routeName: "limited",
  failMode: "closed", // Block if Redis fails
});

// Create limiter: 2 requests per 30 seconds for /limited_1
const limiter2 = new RateLimiter({
  redis,
  maxTokens: 2,
  refillWindow: 30,
  routeName: "limited_1",
  failMode: "closed", // Block if Redis fails
});

// Public route (no limit)
app.get("/public", (req, res) => {
  console.log("User accessed /public");
  res.json({ success: true, message: "This route has no limit" });
});

// Protected route with rate limiter
app.get("/limited", limiter.middleware, (req, res) => {
  console.log("User accessed /limited");
  res.json({ success: true, message: "You passed the /limited rate limiter" });
});

// Another protected route with different rate limiter
app.get("/limited_1", limiter2.middleware, (req, res) => {
  console.log("User accessed /limited_1");
  res.json({ success: true, message: "You passed the /limited_1 rate limiter" });
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

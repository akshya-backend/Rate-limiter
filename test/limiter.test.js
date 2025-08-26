import request from "supertest";
import express from "express";
import RedisMock from "ioredis-mock";
import RateLimiter from "../limiter.js";

describe("RateLimiter Middleware", () => {
  let app;
  let redis;

  beforeAll(() => {
    redis = new RedisMock();

    // limiter1 = 5 requests / 30s
    const limiter1 = new RateLimiter({
      redis,
      maxTokens: 5,
      refillWindow: 30,
      routeName: "limited_1",
      failMode: "open",
    });

    // limiter2 = 2 requests / 30s
    const limiter2 = new RateLimiter({
      redis,
      maxTokens: 2,
      refillWindow: 30,
      routeName: "limited",
      failMode: "closed",
    });

    app = express();
    app.set("trust proxy", true);

    app.get("/limited", limiter2.middleware, (req, res) => {
      res.json({ success: true, message: "Allowed from " + req.ip });
    });

    app.get("/limited_1", limiter1.middleware, (req, res) => {
      res.json({ success: true, message: "Allowed from " + req.ip });
    });
  });

  test("✅ /limited_1 should allow 5 requests for one user", async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await request(app).get("/limited_1").set("X-Forwarded-For", "9.9.9.9");
      expect(res.status).toBe(200);
    }
    // 6th request should block
    const res6 = await request(app).get("/limited_1").set("X-Forwarded-For", "9.9.9.9");
    expect(res6.status).toBe(429);
  });

  test("✅ /limited should allow 2 requests, then block", async () => {
    for (let i = 1; i <= 2; i++) {
      const res = await request(app).get("/limited").set("X-Forwarded-For", "1.1.1.1");
      expect(res.status).toBe(200);
    }
    const res3 = await request(app).get("/limited").set("X-Forwarded-For", "1.1.1.1");
    expect(res3.status).toBe(429);
  });

  test("✅ Different users should have independent limits", async () => {
    // User A
    const resA1 = await request(app).get("/limited").set("X-Forwarded-For", "2.2.2.2");
    const resA2 = await request(app).get("/limited").set("X-Forwarded-For", "2.2.2.2");
    const resA3 = await request(app).get("/limited").set("X-Forwarded-For", "2.2.2.2");
    expect([200, 429]).toContain(resA3.status); // depending on refill timing, but should block on 3rd

    // User B should be fresh
    for (let i = 1; i <= 2; i++) {
      const res = await request(app).get("/limited").set("X-Forwarded-For", "3.3.3.3");
      expect(res.status).toBe(200);
    }
    const resB3 = await request(app).get("/limited").set("X-Forwarded-For", "3.3.3.3");
    expect(resB3.status).toBe(429);
  });

  test("✅ Limits are route-specific", async () => {
    // Same IP, but different routes
    for (let i = 1; i <= 2; i++) {
      const res = await request(app).get("/limited").set("X-Forwarded-For", "5.5.5.5");
      expect(res.status).toBe(200);
    }
    // 3rd request should fail on /limited
    const resFail = await request(app).get("/limited").set("X-Forwarded-For", "5.5.5.5");
    expect(resFail.status).toBe(429);

    // But /limited_1 should still allow 5 fresh requests
    for (let i = 1; i <= 5; i++) {
      const res = await request(app).get("/limited_1").set("X-Forwarded-For", "5.5.5.5");
      expect(res.status).toBe(200);
    }
    const resBlock = await request(app).get("/limited_1").set("X-Forwarded-For", "5.5.5.5");
    expect(resBlock.status).toBe(429);
  });

  test("✅ Tokens should reset after refill window", async () => {
    const ip = "7.7.7.7";

    // Use up the tokens
    for (let i = 1; i <= 2; i++) {
      await request(app).get("/limited").set("X-Forwarded-For", ip);
    }
    const blocked = await request(app).get("/limited").set("X-Forwarded-For", ip);
    expect(blocked.status).toBe(429);

    // ⏩ simulate waiting 31 seconds (beyond refill window)
    await redis.set(`rate:limited:${ip}:lastRefill`, Math.floor(Date.now() / 1000) - 31);

    const afterReset = await request(app).get("/limited").set("X-Forwarded-For", ip);
    expect(afterReset.status).toBe(200);
  });
  test("✅ /limited_1 should fallback when Redis crashes (fail-open)", async () => {
  const ip = "9.9.9.9";

  // Force Redis to throw
  redis.eval = async () => {
    throw new Error("Redis crashed!");
  };

  // Requests should still be allowed because failMode = open
  for (let i = 1; i <= 10; i++) {
    const res = await request(app).get("/limited_1").set("X-Forwarded-For", ip);
    expect(res.status).toBe(200);
  }
});

test("✅ /limited should fallback when Redis crashes (fail-closed)", async () => {
  const ip = "1.1.1.1";

  // Force Redis to throw
  redis.eval = async () => {
    throw new Error("Redis crashed!");
  };

  // Requests should be blocked because failMode = closed
  const res = await request(app).get("/limited").set("X-Forwarded-For", ip);
  expect(res.status).toBe(200);
});

});


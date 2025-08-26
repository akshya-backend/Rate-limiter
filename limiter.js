
export default class RateLimiter {
  constructor({
    redis,
    maxTokens = 10,
    refillWindow = 60,
    routeName = "default",
    failMode = "open", 
  
  }) {
    this.redis = redis;
    this.maxTokens = maxTokens;
    this.refillWindow = refillWindow;
    this.routeName = routeName;
    this.failMode = failMode;

    // In-memory fallback store (not shared across servers)
    this.localBuckets = new Map();

    this.script = `
      local tokenKey = KEYS[1]
      local lastRefillKey = KEYS[2]

      local maxTokens = tonumber(ARGV[1])
      local refillWindow = tonumber(ARGV[2])
      local currentTime = tonumber(ARGV[3])

      local availableTokens = tonumber(redis.call("get", tokenKey))
      if availableTokens == nil then availableTokens = maxTokens end

      local lastRefillTime = tonumber(redis.call("get", lastRefillKey))
      if lastRefillTime == nil then lastRefillTime = currentTime end

      local elapsedTime = currentTime - lastRefillTime
      local tokensToAdd = math.floor(elapsedTime / refillWindow) * maxTokens

      availableTokens = math.min(maxTokens, availableTokens + tokensToAdd)

      if availableTokens > 0 then
        availableTokens = availableTokens - 1
        redis.call("set", tokenKey, availableTokens)
        redis.call("set", lastRefillKey, currentTime)
        return {1, availableTokens}
      else
        return {0, availableTokens}
      end
    `;
  }

  // --- Redis + fallback check ---
  async check(userKey) {
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = await this.redis.eval(
        this.script,
        2,
        `rate:${this.routeName}:${userKey}:tokens`,
        `rate:${this.routeName}:${userKey}:lastRefill`,
        this.maxTokens,
        this.refillWindow,
        now
      );

      return {
        allowed: result[0] === 1,
        remaining: result[1],
        source: "redis",
      };
    } catch (err) {
      console.error(`⚠️ Redis unavailable [${this.routeName}] → using fallback limiter.`, err.message);
      return this.checkFallback(userKey, now);
    }
  }

  // --- Local in-memory fallback limiter ---
  checkFallback(userKey, now) {
    if (!this.localBuckets.has(userKey)) {
      this.localBuckets.set(userKey, {
        tokens: this.maxTokens,
        lastRefill: now,
      });
    }

    const bucket = this.localBuckets.get(userKey);

    // Refill
    const elapsed = now - bucket.lastRefill;
    if (elapsed >= this.refillWindow) {
      bucket.tokens = this.maxTokens;
      bucket.lastRefill = now;
    }

    // Consume
    if (bucket.tokens > 0) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: bucket.tokens, source: "memory" };
    }

    // Fail-open or fail-closed
    if (this.failMode === "open") {
      return { allowed: true, remaining: 0, source: "memory-open" };
    } else {
      return { allowed: false, remaining: 0, source: "memory-closed", };
    }
  }

  // Express middleware
  middleware = async (req, res, next) => {
    const key = req.ip; // or req.userId
    const result = await this.check(key);

    if (!result.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        limiter: result.source,
      });
    }

    next();
  };
}

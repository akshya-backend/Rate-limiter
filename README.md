# Rate-limiter

 **Rate Limiter middleware** for Express.js that supports:

- **Per-route, per-user/IP rate limiting**
- **Redis-backed token bucket** for distributed environments
- **Failover to in-memory buckets** if Redis is down
- Configurable **fail-open** or **fail-closed** behavior

---

## Features

- Token-bucket based rate limiting
- Route-specific configuration
- User/IP-specific limits
- Automatic token refill
- Redis as the primary store (atomic Lua script)
- Local in-memory fallback if Redis crashes
- Configurable `failMode`:
  - `"open"` → allow requests if Redis is down
  - `"closed"` → block requests if Redis is down
- Works with multiple servers in a distributed environment

/**
 * TaskFlow Enterprise Security Middleware
 * - Security HTTP Headers
 * - Sliding Window Rate Limiting (Login Brute Force & Sensitive API Protection)
 * - Safe Error Sanitization
 */

// In-memory sliding window rate limiter
class SlidingWindowRateLimiter {
  constructor(windowMs = 15 * 60 * 1000, maxRequests = 10) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();

    // Periodic cleanup of stale entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  isRateLimited(key) {
    const now = Date.now();
    const timestamps = this.hits.get(key) || [];
    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      const oldest = validTimestamps[0];
      const resetInSeconds = Math.ceil((this.windowMs - (now - oldest)) / 1000);
      return { limited: true, retryAfter: Math.max(1, resetInSeconds), remaining: 0 };
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);
    return { limited: false, retryAfter: 0, remaining: this.maxRequests - validTimestamps.length };
  }

  reset(key) {
    this.hits.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((t) => now - t < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }
}

// 1. Login Rate Limiter: Max 15 failed login attempts per 15 mins per IP/Identifier
const loginLimiterInstance = new SlidingWindowRateLimiter(15 * 60 * 1000, 15);

const loginRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
  const identifier = req.body?.usernameOrEmail || req.body?.email || req.body?.username || '';
  const key = `login:${ip}:${identifier.toLowerCase().trim()}`;

  const check = loginLimiterInstance.isRateLimited(key);
  if (check.limited) {
    res.setHeader('Retry-After', check.retryAfter);
    return res.status(429).json({
      success: false,
      message: `Too many login attempts. Please wait ${check.retryAfter} seconds before trying again.`,
      retryAfter: check.retryAfter,
    });
  }

  // Allow resetting key upon successful login if attached
  req.rateLimitKey = key;
  req.resetLoginRateLimit = () => loginLimiterInstance.reset(key);
  next();
};

// 2. Sensitive API Rate Limiter: Max 200 requests per 10 mins per IP
const apiLimiterInstance = new SlidingWindowRateLimiter(10 * 60 * 1000, 300);

const sensitiveApiRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
  const key = `api:${ip}`;

  const check = apiLimiterInstance.isRateLimited(key);
  if (check.limited) {
    res.setHeader('Retry-After', check.retryAfter);
    return res.status(429).json({
      success: false,
      message: 'Rate limit exceeded. Please slow down your requests.',
      retryAfter: check.retryAfter,
    });
  }
  next();
};

// 3. Security HTTP Headers Middleware
const securityHeaders = (req, res, next) => {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking via iframes
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Enable XSS filter in browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Strict Transport Security (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Prevent IE from executing downloads in site context
  res.setHeader('X-Download-Options', 'noopen');
  // Restrict cross-domain policy files
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // Remove Express powered by header
  res.removeHeader('X-Powered-By');

  next();
};

// 4. Production Safe Global Error Handler
const errorHandler = (err, req, res, next) => {
  console.error('[Unhandled Server Error]', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.user?.username || req.user?.email || 'Anonymous',
    timestamp: new Date().toISOString(),
  });

  const statusCode = err.statusCode || (res.statusCode >= 400 && res.statusCode < 600 ? res.statusCode : 500);

  // Safe message in production, sanitized from internal details
  const isProduction = process.env.NODE_ENV === 'production';
  const safeMessage = isProduction
    ? (statusCode === 500 ? 'An unexpected server error occurred. Please try again later.' : err.message)
    : (err.message || 'Internal Server Error');

  res.status(statusCode).json({
    success: false,
    message: safeMessage,
    errorId: 'ERR-' + Date.now().toString(36).toUpperCase(),
  });
};

module.exports = {
  loginRateLimiter,
  sensitiveApiRateLimiter,
  securityHeaders,
  errorHandler,
  SlidingWindowRateLimiter,
};

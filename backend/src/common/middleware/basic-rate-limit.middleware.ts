import type { NextFunction, Request, RequestHandler, Response } from 'express';

type Bucket = { startedAt: number; count: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const LIMIT = 120;
const SENSITIVE_PATHS = [/^\/api\/auth\//, /^\/api\/upload\//, /^\/api\/payment\//, /^\/api\/gateway\//, /^\/api\/enterprise\/.*invitation/];

function shouldLimit(req: Request): boolean {
  // Model requests use the verified employment identity, not a shared proxy IP.
  if (req.method === 'POST' && /^\/api\/gateway\/v1\/chat\/completions\/?$/i.test(req.path)) return false;
  return SENSITIVE_PATHS.some((pattern) => pattern.test(req.path));
}

function consume(req: Request, res: Response, next: NextFunction, identity: string) {
  const key = `${identity}:${req.path.split('/').slice(0, 4).join('/')}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > LIMIT) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.startedAt)) / 1000))));
    return res.status(429).json({ statusCode: 429, message: '请求过于频繁，请稍后重试' });
  }
  return next();
}

// The synchronous IP-only entry point remains available for anonymous callers.
export function basicRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!shouldLimit(req)) return next();
  return consume(req, res, next, req.ip);
}

/** Use the same signature-verified business identity as the global guard. */
export function createBasicRateLimitMiddleware(getTracker: (req: Request) => Promise<string>): RequestHandler {
  return async (req, res, next) => {
    if (!shouldLimit(req)) return next();
    try {
      consume(req, res, next, await getTracker(req));
    } catch (error) {
      next(error);
    }
  };
}

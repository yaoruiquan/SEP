import type { NextFunction, Request, Response } from 'express';

type Bucket = { startedAt: number; count: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const LIMIT = 120;
const SENSITIVE_PATHS = [/^\/api\/auth\//, /^\/api\/upload\//, /^\/api\/payment\//, /^\/api\/gateway\//, /^\/api\/enterprise\/.*invitation/];

export function basicRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!SENSITIVE_PATHS.some((pattern) => pattern.test(req.path))) return next();
  const key = `${req.ip}:${req.path.split('/').slice(0, 4).join('/')}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > LIMIT) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ statusCode: 429, message: '请求过于频繁，请稍后重试' });
  }
  return next();
}

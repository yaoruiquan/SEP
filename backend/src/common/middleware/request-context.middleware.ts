import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.header('x-request-id')?.slice(0, 100) || randomUUID();
  res.setHeader('x-request-id', requestId);
  (req as Request & { requestId?: string }).requestId = requestId;
  next();
}

import express from 'express';
import type { RequestHandler } from 'express';

export function createJsonBodyMiddleware(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const gateway = express.json({ limit: env.GATEWAY_HTTP_JSON_LIMIT || '4mb' });
  const ordinary = express.json({ limit: env.REQUEST_JSON_LIMIT || '2mb' });
  return (req, res, next) => {
    const parser = req.method === 'POST' && /^\/api\/gateway\/v1\/chat\/completions\/?$/i.test(req.path)
      ? gateway : ordinary;
    parser(req, res, next);
  };
}

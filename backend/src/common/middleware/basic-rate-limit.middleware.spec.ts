import type { NextFunction, Request, Response } from 'express';
import { basicRateLimitMiddleware } from './basic-rate-limit.middleware';

describe('basicRateLimitMiddleware model route exemption', () => {
  let serial = 0;
  function fixture(path: string, method = 'POST') {
    const req = { path, method, ip: `test-proxy-${++serial}` } as Request;
    const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn() as NextFunction & jest.Mock;
    return { req, res, next };
  }

  it.each(['/api/gateway/v1/chat/completions', '/api/gateway/v1/chat/completions/', '/API/GATEWAY/V1/CHAT/COMPLETIONS'])('does not aggregate POST %s by proxy IP', (path) => {
    const { req, res, next } = fixture(path);
    for (let i = 0; i < 150; i++) basicRateLimitMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(150);
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/gateway/v1/chat/completions', 'GET'],
    ['/api/gateway/v1/chat/completions-other', 'POST'],
    ['/api/gateway/v1/models', 'POST'],
    ['/api/auth/login', 'POST'],
    ['/api/payment/pay', 'POST'],
  ])('retains the basic bucket for %s %s', (path, method) => {
    const { req, res, next } = fixture(path, method);
    for (let i = 0; i < 121; i++) basicRateLimitMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(120);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('reports the remaining window and permits requests when it expires', () => {
    let now = 10_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { req, res, next } = fixture('/api/payment/pay');
      for (let i = 0; i < 120; i++) basicRateLimitMiddleware(req, res, next);
      now += 12_345;
      basicRateLimitMiddleware(req, res, next);
      expect(res.setHeader).toHaveBeenLastCalledWith('Retry-After', '48');
      now += 47_654;
      basicRateLimitMiddleware(req, res, next);
      expect(res.setHeader).toHaveBeenLastCalledWith('Retry-After', '1');
      now += 1;
      basicRateLimitMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(121);
    } finally {
      clock.mockRestore();
    }
  });
});

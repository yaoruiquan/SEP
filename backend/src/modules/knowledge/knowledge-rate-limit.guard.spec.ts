import { ExecutionContext, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { KnowledgeRateLimitService } from './knowledge-rate-limit.service';
import { KnowledgeRateLimitGuard } from './knowledge-rate-limit.guard';
import { KnowledgeTelemetryService } from './knowledge-telemetry.service';

describe('KnowledgeRateLimitGuard', () => {
  let resolve: jest.Mock;
  let consume: jest.Mock;
  let guard: KnowledgeRateLimitGuard;
  let setHeader: jest.Mock;
  const viewer = { enterpriseId: 'verified-enterprise', memberId: 'verified-member', role: 'MEMBER', departmentId: null };
  const context = (method = 'POST', user: unknown = { id: 'verified-user', enterpriseId: 'spoofed-enterprise' }): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({ method, user, body: { enterpriseId: 'spoofed', memberId: 'spoofed', query: 'private' },
        query: { memberId: 'spoofed' }, headers: { 'x-enterprise-id': 'spoofed' } }),
      getResponse: () => ({ setHeader }),
    }),
  }) as unknown as ExecutionContext;

  beforeEach(() => {
    resolve = jest.fn().mockResolvedValue(viewer);
    consume = jest.fn().mockResolvedValue({ allowed: true });
    setHeader = jest.fn();
    guard = new KnowledgeRateLimitGuard(
      { resolve } as unknown as KnowledgeAccessPolicy,
      { consume } as unknown as KnowledgeRateLimitService,
    );
  });

  it.each([['POST', 'search'], ['GET', 'source'], ['HEAD', 'source']])('uses verified membership for %s %s', async (method, operation) => {
    await expect(guard.canActivate(context(method))).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith('verified-user');
    expect(consume).toHaveBeenCalledWith({ enterpriseId: viewer.enterpriseId, memberId: viewer.memberId }, operation);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it.each([undefined, null, {}, { id: '' }, { id: 123 }])('does not consume quota without an authenticated user: %j', async user => {
    await expect(guard.canActivate(context('POST', user === undefined ? null : user))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolve).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it('rejects with stable 429 code and Retry-After without exposing quota or identity details', async () => {
    consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 7, exceeded: ['enterprise'], member: { count: 1 } });
    const error = await guard.canActivate(context()).catch(error => error);
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toEqual({
      code: 'KNOWLEDGE_RATE_LIMIT_EXCEEDED', message: 'Knowledge requests are too frequent. Please retry later.', retryAfterSeconds: 7,
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '7');
  });

  it('preserves membership rejection without querying Redis', async () => {
    const error = new ForbiddenException({ code: 'ENTERPRISE_MEMBERSHIP_REQUIRED' });
    resolve.mockRejectedValue(error);
    await expect(guard.canActivate(context())).rejects.toBe(error);
    expect(consume).not.toHaveBeenCalled();
  });

  it('returns a safe 503 when membership storage fails before Redis consumption', async () => {
    resolve.mockRejectedValue(new Error('database credentials and query details'));
    const error = await guard.canActivate(context()).catch(error => error);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ code: 'KNOWLEDGE_SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(error.getResponse())).not.toMatch(/credentials|query details/);
    expect(consume).not.toHaveBeenCalled();
  });

  it('propagates controlled limiter failures and does not convert them to allowance or 429', async () => {
    const error = new Error('controlled error');
    consume.mockRejectedValue(error);
    await expect(guard.canActivate(context())).rejects.toBe(error);
    expect(setHeader).not.toHaveBeenCalledWith('Retry-After', expect.anything());
  });

  it('does not limit preflight methods', async () => {
    await expect(guard.canActivate(context('OPTIONS', null))).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it.each([['POST', 'KNOWLEDGE_SEARCH'], ['GET', 'KNOWLEDGE_SOURCE_READ'], ['HEAD', 'KNOWLEDGE_SOURCE_READ']])(
    'audits %s rejection using only verified identity and safe fields', async (method, action) => {
      const record = jest.fn().mockResolvedValue(undefined);
      const auditedGuard = new KnowledgeRateLimitGuard({ resolve } as unknown as KnowledgeAccessPolicy,
        { consume } as unknown as KnowledgeRateLimitService, { record } as unknown as KnowledgeTelemetryService);
      consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 7, token: 'private', content: 'private' });
      const error = await auditedGuard.canActivate(context(method)).catch(error => error);
      expect(error.getStatus()).toBe(429);
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]).toEqual([
        { actorId: 'verified-user', enterpriseId: viewer.enterpriseId, memberId: viewer.memberId,
          role: viewer.role, departmentId: viewer.departmentId },
        { action, statusCode: 429, resultCode: 'RATE_LIMITED', requestId: expect.stringMatching(
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/), durationMs: expect.any(Number) },
      ]);
      expect(record.mock.calls[0][1].durationMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(record.mock.calls)).not.toMatch(/private|spoofed|query|content|token/);
    },
  );

  it.each(['reject', 'throw'])('keeps controlled 429 and 503 when audit writes %s', async failure => {
    const record = failure === 'reject' ? jest.fn().mockRejectedValue(new Error('audit sensitive detail'))
      : jest.fn(() => { throw new Error('audit sensitive detail'); });
    const auditedGuard = new KnowledgeRateLimitGuard({ resolve } as unknown as KnowledgeAccessPolicy,
      { consume } as unknown as KnowledgeRateLimitService, { record } as unknown as KnowledgeTelemetryService);
    consume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 7 });
    const limited = await auditedGuard.canActivate(context()).catch(error => error);
    expect(limited.getStatus()).toBe(429);
    expect(limited.getResponse().code).toBe('KNOWLEDGE_RATE_LIMIT_EXCEEDED');
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '7');
    const unavailable = new ServiceUnavailableException({ code: 'KNOWLEDGE_RATE_LIMIT_UNAVAILABLE', message: 'unavailable' });
    consume.mockRejectedValueOnce(unavailable);
    await expect(auditedGuard.canActivate(context())).rejects.toBe(unavailable);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1][1]).toMatchObject({ statusCode: 503, resultCode: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/private|spoofed|sensitive detail/);
  });
});

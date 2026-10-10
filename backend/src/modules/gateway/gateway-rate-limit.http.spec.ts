import { Controller, ForbiddenException, Get, INestApplication, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { basicRateLimitMiddleware } from '../../common/middleware/basic-rate-limit.middleware';
import { requestContextMiddleware } from '../../common/middleware/request-context.middleware';
import { RedisService } from '../../redis/redis.service';
import { SecurityModule } from '../security/security.module';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { GatewayRateLimitService } from './gateway-rate-limit.service';
import { GatewayRateLimitGuard } from './gateway-rate-limit.guard';

@Controller()
class OrdinaryController {
  @Get('rate-limit-rest') rest() { return { ok: true }; }
  @Post('auth/rate-limit-login') login() { return { ok: true }; }
}

describe('Gateway production guard chain over HTTP', () => {
  const endpoint = '/api/gateway/v1/chat/completions';
  const secret = 'gateway-test-secret';
  const jwt = new JwtService({ secret });
  const identity = { sub: 'user-1', enterpriseId: 'enterprise-1', memberId: 'member-1', subscriptionId: 'subscription-1', type: 'client-employment' };
  const body = { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hello' }] };
  const token = (changes = {}) => jwt.sign({ ...identity, ...changes }, { expiresIn: '15m' });
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let now: number;
  let app: INestApplication;
  let evalMock: jest.Mock;
  let forward: jest.Mock;
  let authorize: jest.Mock;

  beforeAll(async () => {
    evalMock = jest.fn();
    forward = jest.fn();
    authorize = jest.fn();
    const module = await Test.createTestingModule({
      imports: [SecurityModule],
      controllers: [GatewayController, OrdinaryController],
      providers: [
        GatewayRateLimitGuard, GatewayRateLimitService,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: (name: string) => name === 'ACCESS_JWT_SECRET' ? secret : undefined } },
        { provide: RedisService, useValue: { redis: { eval: evalMock } } },
        { provide: GatewayService, useValue: { validateAndAuthorize: authorize, forwardChatCompletion: forward } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(requestContextMiddleware);
    // Every test client is deliberately seen as the same reverse proxy.
    app.use((req, _res, next) => { Object.defineProperty(req, 'ip', { value: 'shared-proxy' }); next(); });
    app.use(basicRateLimitMiddleware);
    app.useGlobalFilters(new HttpExceptionFilter());
    // Keep one listener for the high-frequency sequence instead of relistening
    // on a new ephemeral port for every supertest request.
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => {
    now = 1_000_000;
    buckets.clear();
    evalMock.mockReset().mockImplementation(async (_script, _keys, key, limit, windowMs) => {
      let bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      const allowed = bucket.count < limit;
      if (allowed) bucket.count++;
      return [Number(allowed), bucket.count, bucket.resetAt - now, bucket.resetAt];
    });
    authorize.mockReset().mockResolvedValue({ ...identity, employeeId: 'employee-1', allowedModels: [body.model, 'other-model'] });
    forward.mockReset().mockImplementation(async () => new Response(JSON.stringify({ choices: [] })));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app?.close());
  function send(employmentToken = token(), payload = body, path = endpoint) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${employmentToken}`).send(payload);
  }

  it('admits 15 sequential agent/tool continuation requests, not just ten', async () => {
    const payload = {
      ...body,
      messages: [...body.messages, { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'ls', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: 'a.txt' }],
    };
    for (let i = 0; i < 15; i++) await send(token(), payload).expect(200);
    expect(forward).toHaveBeenCalledTimes(15);
    expect(evalMock).toHaveBeenCalledTimes(15);
  });

  it('reports the dedicated threshold and decreasing wait, without extending reset time', async () => {
    const employmentToken = token();
    for (let i = 0; i < 60; i++) await send(employmentToken).expect(200);
    const first = await send(employmentToken).set('x-request-id', 'rate-request-1').expect(429);
    expect(first.body.error).toMatchObject({
      source: 'platform', code: 'PLATFORM_RATE_LIMIT_EXCEEDED', requestId: 'rate-request-1',
      rateLimit: { rule: 'gateway-model', dimension: 'enterprise/member/subscription', limit: 60, count: 60, resetAt: 1_060_000, retryAfterSeconds: 60 },
    });
    expect(first.headers['retry-after']).toBe('60');
    expect(first.headers['x-ratelimit-remaining']).toBe('0');
    now += 2300;
    const retry = await send(employmentToken).expect(429);
    expect(retry.headers['retry-after']).toBe('58');
    expect(retry.body.error.rateLimit.resetAt).toBe(1_060_000);
    expect(forward).toHaveBeenCalledTimes(60);
    now = 1_060_000;
    const restored = await send(employmentToken).expect(200);
    expect(restored.headers['x-ratelimit-remaining']).toBe('59');
  });

  it('isolates enterprise, member and subscription despite a shared proxy and 240 requests', async () => {
    for (const change of [{}, { enterpriseId: 'enterprise-2' }, { memberId: 'member-2' }, { subscriptionId: 'subscription-2' }]) {
      const employmentToken = token(change);
      for (let i = 0; i < 60; i++) await send(employmentToken).expect(200);
      await send(employmentToken).expect(429);
    }
    expect(forward).toHaveBeenCalledTimes(240);
    expect(buckets.size).toBe(4);
  });

  it('shares the identity bucket across models, sessions and trailing slash routes', async () => {
    const employmentToken = token();
    for (let i = 0; i < 60; i++) {
      await send(employmentToken, { ...body, model: i % 2 ? body.model : 'other-model' }, i % 2 ? endpoint : `${endpoint}/`)
        .set('x-sep-session-id', `session-${i}`).expect(200);
    }
    await send(employmentToken, { ...body, model: 'other-model' }).expect(429);
    expect(buckets.size).toBe(1);
  });

  it('rejects unsigned, expired, wrong-type or incomplete tokens before counting', async () => {
    const invalidTokens = [
      'forged', new JwtService({ secret: 'wrong' }).sign(identity),
      jwt.sign(identity, { expiresIn: -1 }), token({ type: 'access' }),
      ...['sub', 'enterpriseId', 'memberId', 'subscriptionId'].flatMap((field) => [token({ [field]: '' }), token({ [field]: null })]),
      jwt.sign(identity),
    ];
    for (const invalid of invalidTokens) await send(invalid).expect(401);
    await request(app.getHttpServer()).post(endpoint).send(body).expect(401);
    expect(evalMock).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it('fails closed without calling the model when Redis is unavailable', async () => {
    evalMock.mockRejectedValue(new Error('private Redis failure'));
    const res = await send().expect(503);
    expect(res.body.error).toMatchObject({ source: 'platform', code: 'PLATFORM_RATE_LIMIT_UNAVAILABLE' });
    expect(forward).not.toHaveBeenCalled();
  });

  it('counts authenticated invalid payloads and business authorization failures before execution', async () => {
    const employmentToken = token();
    await send(employmentToken, { ...body, messages: [{ role: 'tool', content: 'missing tool_call_id' }] }).expect(400);
    expect(authorize).not.toHaveBeenCalled();
    authorize.mockRejectedValue(new ForbiddenException('No subscription grant'));
    await send(employmentToken).expect(403);
    expect(evalMock).toHaveBeenCalledTimes(2);
    expect([...buckets.values()]).toEqual([{ count: 2, resetAt: 1_060_000 }]);
    expect(forward).not.toHaveBeenCalled();
  });

  it('keeps existing auth/default/chat rules on ordinary REST and login routes', async () => {
    for (const [method, path] of [['get', '/api/rate-limit-rest'], ['post', '/api/auth/rate-limit-login']] as const) {
      for (let i = 0; i < 10; i++) await request(app.getHttpServer())[method](path).expect(method === 'post' ? 201 : 200);
      const res = await request(app.getHttpServer())[method](path).expect(429);
      expect(res.headers['retry-after-auth']).toBeDefined();
      expect(res.body).not.toHaveProperty('error');
    }
    expect(evalMock).not.toHaveBeenCalled();
  });
});

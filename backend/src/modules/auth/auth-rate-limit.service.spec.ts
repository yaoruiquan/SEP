import { AuthRateLimitService } from './auth-rate-limit.service';

describe('AuthRateLimitService', () => {
  const redis = { incr: jest.fn(), expire: jest.fn(), ttl: jest.fn(), get: jest.fn() };
  const redisService = { get redis() { return redis; } };
  const config = { get: jest.fn() };
  let service: AuthRateLimitService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(undefined);
    service = new AuthRateLimitService(redisService as any, config as any);
  });

  it('uses a hashed Redis key and blocks after the configured limit', async () => {
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(3);
    redis.expire.mockResolvedValue(1);
    redis.ttl.mockResolvedValue(58);
    await expect(service.consume('login-ip', '192.0.2.1', { limit: 2, windowSeconds: 60 }))
      .resolves.toMatchObject({ allowed: true, count: 1 });
    await expect(service.consume('login-ip', '192.0.2.1', { limit: 2, windowSeconds: 60 }))
      .resolves.toMatchObject({ allowed: false, count: 3 });
    expect(redis.incr.mock.calls[0][0]).toMatch(/^sep:auth:rate:login-ip:[a-f0-9]{64}$/);
    expect(redis.incr.mock.calls[0][0]).not.toContain('192.0.2.1');
  });

  it('keeps identities isolated', async () => {
    redis.incr.mockResolvedValue(1);
    redis.ttl.mockResolvedValue(60);
    await service.consume('login-account', 'a@example.com', { limit: 5, windowSeconds: 60 });
    await service.consume('login-account', 'b@example.com', { limit: 5, windowSeconds: 60 });
    expect(redis.incr.mock.calls[0][0]).not.toBe(redis.incr.mock.calls[1][0]);
  });

  it('fails open when Redis is unavailable', async () => {
    redis.incr.mockRejectedValue(new Error('connection refused'));
    await expect(service.consume('password-reset', 'hash', { limit: 3, windowSeconds: 60 }))
      .resolves.toMatchObject({ allowed: true, count: 0 });
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { SessionLockService, SESSION_LOCK_RENEW_INTERVAL_MS } from './session-lock.service';

describe('SessionLockService ownership and renewal', () => {
  const redis = { set: jest.fn(), eval: jest.fn() };
  const service = new SessionLockService({ redis } as never);
  beforeEach(() => { jest.resetAllMocks(); jest.useFakeTimers(); });
  afterEach(() => jest.useRealTimers());

  it('renews only the owning lock, and stops the timer in finally', async () => {
    redis.eval.mockResolvedValue(1);
    const lost = jest.fn();
    const stop = service.startRenewal('session', 'owner', lost);
    await jest.advanceTimersByTimeAsync(SESSION_LOCK_RENEW_INTERVAL_MS * 4);
    expect(redis.eval).toHaveBeenCalledTimes(4);
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('ARGV[1]'), 1, 'lock:session:session', 'owner', 60);
    await stop();
    await jest.advanceTimersByTimeAsync(60000);
    expect(redis.eval).toHaveBeenCalledTimes(4);
    expect(lost).not.toHaveBeenCalled();
  });

  it.each([false, true])('aborts further dispatch on owner loss or Redis failure (%s)', async (redisFailure) => {
    if (redisFailure) redis.eval.mockRejectedValue(new Error('redis down'));
    else redis.eval.mockResolvedValue(0);
    const lost = jest.fn();
    const stop = service.startRenewal('session', 'owner', lost);
    await jest.advanceTimersByTimeAsync(SESSION_LOCK_RENEW_INTERVAL_MS * 3);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(lost.mock.calls[0][0]).toBeInstanceOf(ServiceUnavailableException);
    await stop();
  });

  it('releases using owner CAS and does not unconditionally delete a replacement lock', async () => {
    redis.eval.mockResolvedValue(0);
    await service.releaseLock('session', 'old-owner');
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('== ARGV[1]'), 1, 'lock:session:session', 'old-owner');
  });

  it('fails closed when acquiring cannot reach Redis', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));
    await expect(service.acquireLock('session')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not acquire an already cancelled request', async () => {
    await expect(service.acquireLock('session', AbortSignal.abort())).rejects.toBeDefined();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

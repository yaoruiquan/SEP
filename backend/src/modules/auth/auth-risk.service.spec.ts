import { UnauthorizedException } from '@nestjs/common';
import { AuthRiskService } from './auth-risk.service';

describe('AuthRiskService', () => {
  let prisma: any;
  let events: any;
  let service: AuthRiskService;
  const config = { get: jest.fn((key: string) => ({ AUTH_MAX_FAILED_ATTEMPTS: '3', AUTH_LOCK_MINUTES: '10' } as any)[key]) };

  beforeEach(() => {
    prisma = {
      authCredential: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    events = { record: jest.fn().mockResolvedValue(undefined) };
    service = new AuthRiskService(prisma, config as any, events);
  });

  it('rejects a currently locked credential and records the failure', async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    await expect(service.assertLoginAllowed('u1', {
      passwordHash: 'hash', failedCount: 3, lockedUntil,
    }, { provider: 'password', emailHash: 'hash-email' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN_FAILED',
      success: false,
      metadata: { emailHash: 'hash-email', reason: 'account_locked' },
    }));
  });

  it('locks after the configured number of failures without exposing credentials', async () => {
    prisma.authCredential.findUnique.mockResolvedValue({ failedCount: 2, lockedUntil: null });
    await service.recordPasswordFailure('u1', 'hash', { provider: 'password' });
    const data = prisma.authCredential.upsert.mock.calls[0][0].update;
    expect(data.failedCount).toBe(3);
    expect(data.lockedUntil).toEqual(expect.any(Date));
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACCOUNT_LOCKED' }));
    expect(events.record.mock.calls.flat().join(' ')).not.toContain('hash');
  });

  it('resets failure state after a successful login', async () => {
    await service.recordPasswordSuccess('u1');
    expect(prisma.authCredential.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', type: 'LOCAL_PASSWORD' },
      data: expect.objectContaining({ failedCount: 0, lockedUntil: null }),
    }));
  });
});

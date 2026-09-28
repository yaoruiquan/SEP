import { UnauthorizedException } from '@nestjs/common';
import { SessionService } from './session.service';

const config = {
  get: jest.fn((key: string) => key === 'REFRESH_TOKEN_PEPPER' ? 'test-refresh-pepper' : undefined),
  getOrThrow: jest.fn(() => 'test-jwt-secret'),
};

describe('SessionService', () => {
  let prisma: any;
  let service: SessionService;

  beforeEach(() => {
    prisma = {
      authSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      authToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (input: any) => {
        if (Array.isArray(input)) return Promise.all(input);
        return input(prisma);
      }),
    };
    service = new SessionService(prisma, config as any);
  });

  it('creates a session and stores only a peppered hash', async () => {
    const result = await service.createSession({
      userId: 'user-1', clientType: 'WEB', refreshTtlSeconds: 3600,
    });

    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.refreshToken.length).toBeGreaterThanOrEqual(40);
    const tokenData = prisma.authToken.create.mock.calls[0][0].data;
    expect(tokenData.tokenHash).toEqual(expect.any(String));
    expect(tokenData.tokenHash).not.toBe(result.refreshToken);
    expect(tokenData.tokenHash).toHaveLength(64);
    expect(prisma.authSession.create.mock.calls[0][0].data).toMatchObject({
      userId: 'user-1', type: 'WEB', familyId: result.familyId,
    });
  });

  it('rotates a refresh token and consumes the old token', async () => {
    const current = {
      id: 'token-1', sessionId: 'session-1', familyId: 'family-1',
      tokenHash: 'hash', usedAt: null, revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: {
        id: 'session-1', userId: 'user-1', type: 'WEB', familyId: 'family-1',
        deviceId: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
      },
    };
    prisma.authToken.findUnique.mockResolvedValue(current);
    prisma.authToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.rotateRefreshToken('presented-token', 'WEB');

    expect(result).toMatchObject({ sessionId: 'session-1', userId: 'user-1', familyId: 'family-1' });
    expect(result.refreshToken).not.toBe('presented-token');
    expect(prisma.authToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'token-1', usedAt: null, revokedAt: null },
      data: expect.objectContaining({ usedAt: expect.any(Date) }),
    });
    expect(prisma.authToken.create).toHaveBeenCalledTimes(1);
    expect(prisma.authSession.update).toHaveBeenCalledTimes(1);
  });

  it('revokes the whole family when a used token is replayed', async () => {
    prisma.authToken.findUnique.mockResolvedValue({
      id: 'token-1', familyId: 'family-1', usedAt: new Date(), revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: {
        id: 'session-1', userId: 'user-1', type: 'WEB', familyId: 'family-1',
        deviceId: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const revokeFamily = jest.spyOn(service, 'revokeSessionFamily').mockResolvedValue();

    await expect(service.rotateRefreshToken('replayed-token', 'WEB'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(revokeFamily).toHaveBeenCalledWith('family-1', 'refresh_token_reuse');
  });

  it('detects replay during validation and revokes the whole family', async () => {
    prisma.authToken.findUnique.mockResolvedValue({
      familyId: 'family-2', usedAt: new Date(), revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: {
        id: 'session-2', userId: 'user-2', type: 'DESKTOP', familyId: 'family-2',
        deviceId: 'device-2', revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const revokeFamily = jest.spyOn(service, 'revokeSessionFamily').mockResolvedValue();

    await expect(service.validateRefreshToken('replayed-token', 'DESKTOP'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(revokeFamily).toHaveBeenCalledWith('family-2', 'refresh_token_reuse');
  });

  it('treats a concurrent rotation race as token reuse and revokes the family', async () => {
    const current = {
      id: 'token-race', familyId: 'family-race', usedAt: null, revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: {
        id: 'session-race', userId: 'user-race', type: 'WEB', familyId: 'family-race',
        deviceId: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
      },
    };
    prisma.authToken.findUnique.mockResolvedValue(current);
    prisma.authToken.updateMany.mockResolvedValue({ count: 0 });
    const revokeFamily = jest.spyOn(service, 'revokeSessionFamily').mockResolvedValue();

    await expect(service.rotateRefreshToken('race-token', 'WEB'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(revokeFamily).toHaveBeenCalledWith('family-race', 'refresh_token_reuse');
  });

  it.each([
    ['WEB', 'DESKTOP'],
    ['DESKTOP', 'WEB'],
  ] as const)('does not allow %s token for %s client', async (storedType, requestedType) => {
    prisma.authToken.findUnique.mockResolvedValue({
      familyId: 'family-1', usedAt: null, revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: {
        id: 'session-1', userId: 'user-1', type: storedType, familyId: 'family-1',
        deviceId: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(service.validateRefreshToken('token', requestedType))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('marks the access-token session as current when listing sessions', async () => {
    prisma.authSession.findMany.mockResolvedValue([
      {
        id: 'session-current', type: 'WEB', deviceId: null,
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-09-24T00:00:00.000Z'),
        createdAt: new Date('2026-09-23T00:00:00.000Z'),
      },
      {
        id: 'session-other', type: 'DESKTOP', deviceId: 'device-1',
        expiresAt: new Date('2026-10-02T00:00:00.000Z'),
        lastUsedAt: null,
        createdAt: new Date('2026-09-22T00:00:00.000Z'),
      },
    ]);

    await expect(service.listUserSessions('user-1', 'session-current')).resolves.toEqual([
      expect.objectContaining({ id: 'session-current', isCurrent: true }),
      expect.objectContaining({ id: 'session-other', isCurrent: false }),
    ]);
    expect(prisma.authSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', revokedAt: null },
    }));
  });

  it('revokes current session and all sessions through scoped database updates', async () => {
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.authToken.updateMany.mockResolvedValue({ count: 1 });

    await service.revokeSession('session-1', 'logout');
    await service.revokeAllUserSessions('user-1', 'logout_all');

    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1', revokedAt: null },
    }));
    expect(prisma.authToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { session: { userId: 'user-1' }, revokedAt: null },
    }));
  });
});

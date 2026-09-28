import { AuthEventService } from './auth-event.service';

describe('AuthEventService', () => {
  let prisma: any;
  let service: AuthEventService;

  beforeEach(() => {
    prisma = {
      authEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new AuthEventService(prisma);
  });

  it('records an event with a successful default and audit metadata', async () => {
    await service.record({
      userId: 'user-1',
      action: 'LOGIN_SUCCESS',
      provider: 'password',
      sessionId: 'session-1',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      metadata: { source: 'web' },
    });

    expect(prisma.authEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'LOGIN_SUCCESS',
        success: true,
        provider: 'password',
        sessionId: 'session-1',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        metadata: { source: 'web' },
      },
    });
  });

  it('preserves failed status without accepting sensitive credential fields', async () => {
    await service.record({
      userId: 'user-1',
      action: 'LOGIN_FAILED',
      success: false,
      metadata: { reason: 'invalid_password' },
    });

    const data = prisma.authEvent.create.mock.calls[0][0].data;
    expect(data.success).toBe(false);
    expect(data.metadata).not.toHaveProperty('password');
    expect(data.metadata).not.toHaveProperty('token');
  });

  it('clamps query limits to the safe 1..100 range and orders newest first', async () => {
    await service.listForUser('user-1', 999);
    expect(prisma.authEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }));

    await service.listForUser('user-1', 0);
    expect(prisma.authEvent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));
  });

  it('does not block the authentication flow when persistence fails', async () => {
    prisma.authEvent.create.mockRejectedValue(new Error('database unavailable'));
    await expect(service.record({ userId: 'user-1', action: 'LOGIN_SUCCESS' })).resolves.toBeUndefined();
  });
  it('strips credential-like metadata keys before persistence', async () => {
    await service.record({
      action: 'OAUTH_CALLBACK_FAILED',
      metadata: { reason: 'provider_error', password: 'secret', token: 'opaque', nested: { code: 'x' } },
    });
    expect(prisma.authEvent.create.mock.calls[0][0].data.metadata).toEqual({
      reason: 'provider_error',
      nested: {},
    });
  });

  it('recursively strips sensitive keys from nested objects and arrays case-insensitively', async () => {
    await service.record({
      action: 'OAUTH_CALLBACK_FAILED',
      metadata: {
        safe: 'value',
        nested: { Password: 'x', details: { ACCESS_TOKEN: 'y', keep: true } },
        items: [{ code: 'z', label: 'visible' }],
      },
    });

    expect(prisma.authEvent.create.mock.calls[0][0].data.metadata).toEqual({
      safe: 'value',
      nested: { details: { keep: true } },
      items: [{ label: 'visible' }],
    });
  });

});

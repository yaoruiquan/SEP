import { BadRequestException, HttpException } from '@nestjs/common';
import { AuthService } from './auth.service';

function makeAuth() {
  const createdUser = {
    id: 'user-1', email: 'new@example.com', name: 'New User', avatar: null, role: 'USER',
  };
  const tx: any = {
    user: { create: jest.fn().mockResolvedValue({ ...createdUser, emailVerifiedAt: new Date() }) },
    enterprise: { create: jest.fn().mockResolvedValue({ id: 'enterprise-1', name: 'New Enterprise' }) },
    enterpriseMember: { create: jest.fn().mockResolvedValue({ id: 'member-1', role: 'ENTERPRISE_ADMIN' }) },
    enterpriseInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  tx.enterprise.findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'enterprise-1', name: 'Existing Enterprise' });

  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((callback: any) => callback(tx)),
  };
  const invitations = {
    findUsableByToken: jest.fn().mockResolvedValue({
      id: 'invitation-1',
      email: 'new@example.com',
      enterpriseId: 'enterprise-1',
      role: 'MEMBER',
      departmentId: null,
      position: null,
    }),
  };
  const defaults = { createDefaultDepartments: jest.fn().mockResolvedValue(undefined) };
  const sessions = {
    createSession: jest.fn().mockResolvedValue({ sessionId: 'session-1', refreshToken: 'refresh-token' }),
    getRefreshTtlSeconds: jest.fn().mockReturnValue(3600),
  };
  const jwt = { sign: jest.fn().mockReturnValue('access-token') };
  const config = { get: jest.fn(), getOrThrow: jest.fn().mockReturnValue('test-jwt-secret') };
  const registrationCodes = { issue: jest.fn().mockResolvedValue(undefined), consume: jest.fn().mockResolvedValue(undefined) };
  const rateLimit = { consume: jest.fn().mockResolvedValue({ allowed: true }) };
  const service = new AuthService(
    prisma,
    jwt as any,
    config as any,
    invitations as any,
    defaults as any,
    sessions as any,
    undefined,
    undefined,
    undefined,
    undefined,
    rateLimit as any,
    registrationCodes as any,
  );

  return { service, prisma, tx, invitations, registrationCodes, rateLimit, sessions };
}

describe('AuthService registration email verification', () => {
  it('normalizes the email, applies per-email and per-IP limits, and returns a non-enumerating response', async () => {
    const { service, registrationCodes, rateLimit } = makeAuth();

    const response = await service.requestRegistrationEmailCode(
      { email: ' New@Example.com ' },
      { ipAddress: '192.0.2.10' },
    );

    expect(registrationCodes.issue).toHaveBeenCalledWith('new@example.com');
    expect(rateLimit.consume).toHaveBeenNthCalledWith(1, 'registration-email-code-email', 'new@example.com', { limit: 3, windowSeconds: 3600 });
    expect(rateLimit.consume).toHaveBeenNthCalledWith(2, 'registration-email-code-ip', '192.0.2.10', { limit: 10, windowSeconds: 3600 });
    expect(response.message).toContain('如果该邮箱可用于注册');
  });

  it('returns the same response for an already registered email without sending a code', async () => {
    const { service, prisma, registrationCodes } = makeAuth();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });

    const response = await service.requestRegistrationEmailCode({ email: 'new@example.com' });

    expect(registrationCodes.issue).not.toHaveBeenCalled();
    expect(response.message).toContain('如果该邮箱可用于注册');
  });

  it('rejects a limited email or IP before attempting delivery', async () => {
    const { service, registrationCodes, rateLimit } = makeAuth();
    rateLimit.consume.mockResolvedValueOnce({ allowed: false });

    await expect(service.requestRegistrationEmailCode({ email: 'new@example.com' }))
      .rejects.toBeInstanceOf(HttpException);
    expect(registrationCodes.issue).not.toHaveBeenCalled();
  });

  it('requires a valid code before self-registration and marks the new email verified', async () => {
    const { service, tx, registrationCodes } = makeAuth();

    await service.register({
      email: 'new@example.com',
      emailCode: '123456',
      password: 'password123',
      enterpriseName: 'New Enterprise',
      name: 'New User',
    }, { cookie: jest.fn() } as any);

    expect(registrationCodes.consume).toHaveBeenCalledWith('new@example.com', '123456');
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
    }));
  });

  it('does not create a user or enterprise when the self-registration code is invalid', async () => {
    const { service, prisma, registrationCodes } = makeAuth();
    registrationCodes.consume.mockRejectedValueOnce(new BadRequestException('验证码错误或已过期'));

    await expect(service.register({
      email: 'new@example.com',
      emailCode: '000000',
      password: 'password123',
      enterpriseName: 'New Enterprise',
    }, { cookie: jest.fn() } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires a valid code before invitation registration and marks the new email verified', async () => {
    const { service, tx, registrationCodes } = makeAuth();

    await service.registerByInvitation({
      token: 'invitation-token',
      email: 'new@example.com',
      emailCode: '123456',
      password: 'password123',
      name: 'New User',
    }, { cookie: jest.fn() } as any);

    expect(registrationCodes.consume).toHaveBeenCalledWith('new@example.com', '123456');
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
    }));
  });
});

import { AuthService } from './auth.service';

describe('AuthService password and email recovery', () => {
  function make() {
    const user = { id: 'u1', email: 'u@example.com', name: 'U', avatar: null, role: 'USER', status: 'ACTIVE' };
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'u1', status: 'ACTIVE' }]),
      user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue(user) },
      authCredential: {
        findUnique: jest.fn().mockResolvedValue({ passwordHash: '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy' }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(prisma)),
    };
    const tokens = { issue: jest.fn().mockResolvedValue({ token: 'secret-token', expiresAt: new Date() }), consume: jest.fn() };
    const mail = { sendPasswordReset: jest.fn().mockResolvedValue(undefined), sendPasswordChanged: jest.fn().mockResolvedValue(undefined), sendEmailVerification: jest.fn().mockResolvedValue(undefined) };
    const sessions = { revokeAllUserSessions: jest.fn(), revokeAllUserSessionsExcept: jest.fn() };
    const config = { get: jest.fn().mockReturnValue('http://localhost:3000'), getOrThrow: jest.fn().mockReturnValue('secret') };
    const service = new AuthService(prisma, { sign: jest.fn() } as any, config as any, {} as any, {} as any, sessions as any, tokens as any, mail as any);
    return { service, prisma, tokens, mail, sessions, user };
  }

  it('忘记密码对外统一响应并给存在用户发邮件', async () => {
    const { service, tokens, mail } = make();
    const result = await service.requestPasswordReset({ email: 'u@example.com' });
    expect(result.message).toContain('如果该邮箱已注册');
    expect(tokens.issue).toHaveBeenCalledWith({ userId: 'u1', type: 'PASSWORD_RESET' });
    expect(mail.sendPasswordReset).toHaveBeenCalledWith(expect.objectContaining({ to: 'u@example.com' }));
  });

  it('密码重置后撤销全部会话并发送通知', async () => {
    const { service, tokens, mail, sessions } = make();
    tokens.consume.mockResolvedValue({ userId: 'u1', type: 'PASSWORD_RESET', metadata: null });
    await service.resetPassword({ token: 'secret-token', newPassword: 'NewPassword123' });
    expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith('u1', 'password_reset');
    expect(mail.sendPasswordChanged).toHaveBeenCalledWith({ to: 'u@example.com' });
  });

  it('邮箱验证确认只写入当前用户', async () => {
    const { service, tokens, prisma } = make();
    tokens.consume.mockResolvedValue({ userId: 'u1', type: 'EMAIL_VERIFICATION', metadata: null });
    await service.confirmEmailVerification({ token: 'email-token' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { emailVerifiedAt: expect.any(Date) } });
  });

  it('修改密码要求当前邮箱已验证后才允许变更邮箱', async () => {
    const { service, prisma } = make();
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ email: 'u@example.com', emailVerifiedAt: null, status: 'ACTIVE' });
    await expect(
      service.requestEmailChange('u1', { newEmail: 'new@example.com' }),
    ).rejects.toThrow('请先验证当前邮箱');
  });

  it.each(['CLOSURE_PENDING', 'CLOSED', 'DISABLED'])('does not send password reset mail for %s accounts', async (status) => {
    const { service, prisma, tokens, mail, user } = make();
    prisma.user.findUnique.mockResolvedValue({ ...user, status });
    await expect(service.requestPasswordReset({ email: user.email })).resolves.toHaveProperty('message');
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it.each(['CLOSURE_PENDING', 'CLOSED', 'DISABLED'])('rejects password and OAuth login for %s accounts', async (status) => {
    const { service, prisma, user } = make();
    prisma.user.findUnique.mockResolvedValue({ ...user, status });
    await expect(service.login({ email: user.email, password: 'Password123' }, {} as any)).rejects.toThrow('账号当前不可登录');
    await expect(service.loginWithUser(user.id, {} as any)).rejects.toThrow('账号当前不可登录');
  });

  it.each(['PASSWORD_RESET', 'EMAIL_VERIFICATION', 'EMAIL_CHANGE'])('rejects old %s tokens when closure starts before the mutation', async (type) => {
    const { service, prisma, tokens, sessions } = make();
    tokens.consume.mockResolvedValue({ userId: 'u1', type, metadata: { newEmail: 'new@example.com' } });
    prisma.$queryRaw.mockResolvedValue([{ id: 'u1', status: 'CLOSURE_PENDING' }]);
    const action = type === 'PASSWORD_RESET'
      ? service.resetPassword({ token: 'old-token', newPassword: 'NewPassword123' })
      : type === 'EMAIL_VERIFICATION'
        ? service.confirmEmailVerification({ token: 'old-token' })
        : service.confirmEmailChange({ token: 'old-token' });
    await expect(action).rejects.toThrow('令牌无效或已过期');
    expect(prisma.authCredential.upsert).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
  });
});

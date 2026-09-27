import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService', () => {
  const prisma: any = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const sessions: any = { revokeAllUserSessions: jest.fn() };
  const events: any = { record: jest.fn(), listForUser: jest.fn() };
  const auth: any = { requestEmailVerification: jest.fn(), requestPasswordReset: jest.fn() };
  let service: AdminAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminAuthService(prisma, sessions, events, auth);
  });

  it('lists users with status filter, pagination and safe counters', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', _count: { authIdentities: 2, authSessions: 1, authEvents: 4 }, email: 'a@example.com' }]);
    prisma.user.count.mockResolvedValue(1);
    await expect(service.listUsers({ status: UserStatus.ACTIVE, keyword: 'a', page: 2, pageSize: 10 })).resolves.toMatchObject({ total: 1, page: 2, pageSize: 10 });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining({ status: UserStatus.ACTIVE }) }));
  });

  it('disables a normal user and revokes every session', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'USER', status: UserStatus.ACTIVE });
    await expect(service.disableUser('u1', 'admin-1', '违规')).resolves.toMatchObject({ status: UserStatus.DISABLED });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { status: UserStatus.DISABLED } });
    expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith('u1', 'admin_disabled');
  });

  it('protects the current and other platform administrators', async () => {
    await expect(service.disableUser('admin-1', 'admin-1', 'x')).rejects.toBeInstanceOf(BadRequestException);
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-2', role: 'ADMIN', status: UserStatus.ACTIVE });
    await expect(service.disableUser('admin-2', 'admin-1', 'x')).rejects.toBeInstanceOf(ConflictException);
  });

  it('forces email verification and password reset through existing one-time-token flows', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'u1', emailVerifiedAt: new Date() })
      .mockResolvedValueOnce({ id: 'u1', email: 'a@example.com' });
    auth.requestEmailVerification.mockResolvedValue({ message: 'sent' });
    auth.requestPasswordReset.mockResolvedValue({ message: 'sent' });
    await expect(service.forceEmailVerification('u1', 'admin-1')).resolves.toEqual({ message: 'sent' });
    await expect(service.forcePasswordReset('u1', 'admin-1')).resolves.toEqual({ message: 'sent' });
    expect(auth.requestEmailVerification).toHaveBeenCalledWith('u1', true);
    expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith('u1', 'admin_force_password_reset');
  });

  it('returns not found for missing users', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getUserDetail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('aggregates security metrics by action and success', async () => {
    prisma.authEvent = { findMany: jest.fn().mockResolvedValue([
      { action: 'LOGIN_FAILED', success: false },
      { action: 'LOGIN_FAILED', success: true },
      { action: 'LOGIN_SUCCESS', success: true },
    ]) };
    await expect(service.getSecurityMetrics(24)).resolves.toMatchObject({
      total: 3,
      success: 2,
      failed: 1,
      byAction: {
        LOGIN_FAILED: { total: 2, success: 1, failed: 1 },
        LOGIN_SUCCESS: { total: 1, success: 1, failed: 0 },
      },
    });
  });
});

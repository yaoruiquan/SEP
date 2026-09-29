import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClientService } from './client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { SettingService } from '../setting/setting.service';
import { JwtService } from '@nestjs/jwt';
import { withEmployeeAvatar } from '../../common/employee-avatar';
import { SessionService } from '../auth/session.service';
import { MemberAllowanceQueryService } from '../compute-credit/member-allowance-query.service';
import { PersonalWalletService } from '../personal-wallet/personal-wallet.service';
import { SubscriptionRequestService } from '../subscription-request/subscription-request.service';

describe('ClientService', () => {
  let service: ClientService;
  let prisma: any;
  let jwt: any;
  let sessions: any;
  let allowanceQuery: any;
  let personalWallet: any;

  beforeEach(async () => {
    prisma = {
      device: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
      user: { findUnique: jest.fn() },
      enterpriseMember: { findFirst: jest.fn() },
      employeeGrant: { findMany: jest.fn(), findFirst: jest.fn() },
      platformModel: { findMany: jest.fn() },
      enterpriseModelConfig: { findUnique: jest.fn() },
      subscription: { findFirst: jest.fn() },
      digitalEmployee: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    };
    jwt = { sign: jest.fn().mockReturnValue('access-token'), verify: jest.fn() };
    allowanceQuery = { getOne: jest.fn() };
    personalWallet = { getView: jest.fn() };
    sessions = {
      validateRefreshToken: jest.fn().mockResolvedValue({
        sessionId: 'session-1', userId: 'user-1', deviceId: 'device-1',
      }),
      rotateRefreshToken: jest.fn().mockResolvedValue({
        sessionId: 'session-1', userId: 'user-1', deviceId: 'device-1', refreshToken: 'next-refresh',
      }),
      getRefreshTtlSeconds: jest.fn().mockReturnValue(30 * 24 * 60 * 60),
      createSession: jest.fn().mockResolvedValue({ sessionId: 'session-1', refreshToken: 'refresh-token' }),
      revokeSession: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ClientService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn(), getOrThrow: jest.fn().mockReturnValue('explicit-test-jwt-secret') } },
        { provide: SettingService, useValue: { getEffectiveValue: jest.fn() } },
        { provide: SessionService, useValue: sessions },
        { provide: MemberAllowanceQueryService, useValue: allowanceQuery },
        { provide: PersonalWalletService, useValue: personalWallet },
        { provide: SubscriptionRequestService, useValue: { createRequest: jest.fn(), getClientRequest: jest.fn() } },
        {
          provide: EnterpriseContextService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({
              enterpriseId: 'ent-1', memberId: 'member-1', departmentId: 'dept-1', role: 'MEMBER',
            }),
            resolveOrNull: jest.fn().mockResolvedValue({
              enterpriseId: 'ent-1', memberId: 'member-1', departmentId: 'dept-1', role: 'MEMBER',
            }),
          },
        },
      ],
    }).compile();
    service = module.get(ClientService);
  });

  it('lists only approved platform employees with paginated capability summaries', async () => {
    prisma.digitalEmployee.count.mockResolvedValue(1);
    prisma.digitalEmployee.findMany.mockResolvedValue([
      {
        id: 'emp-platform-1',
        name: '数据分析员工',
        avatar: null,
        avatarStyle: null,
        avatarBindings: null,
        position: '数据分析师',
        description: '负责数据分析',
        functionalCategory: 'TECH',
        status: 'APPROVED',
        updatedAt: new Date('2026-09-29T08:30:00.000Z'),
        bindings: [{ capability: { id: 'cap-1', name: '数据分析', description: '分析数据', type: 'SKILL' } }],
      },
    ]);

    await expect(service.listPlatformEmployees({ page: 1, pageSize: 20, sort: 'updatedAt_desc' })).resolves.toMatchObject({
      total: 1,
      hasNextPage: false,
      items: [{ employeeId: 'emp-platform-1', canApply: true, capabilities: [{ id: 'cap-1' }] }],
    });
    expect(prisma.digitalEmployee.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'APPROVED' },
      skip: 0,
      take: 20,
    });
  });

  it('creates a platform employee access request without trusting client identity fields', async () => {
    prisma.digitalEmployee.findFirst.mockResolvedValue({ id: 'emp-platform-1' });
    const createRequest = (service as any).subscriptionRequests.createRequest;
    createRequest.mockResolvedValue({
      id: 'request-1',
      status: 'PENDING',
      clientTargetType: 'PLATFORM_EMPLOYEE',
      employeeId: 'emp-platform-1',
      employee: { id: 'emp-platform-1', name: '数据分析员工' },
      subscriptionId: null,
      requestedCapabilities: ['cap-1'],
      createdAt: new Date('2026-09-29T08:30:00.000Z'),
      updatedAt: new Date('2026-09-29T08:30:00.000Z'),
    });

    await expect(service.createEmployeeAccessRequest('user-1', {
      targetType: 'PLATFORM_EMPLOYEE',
      employeeId: 'emp-platform-1',
      subscriptionId: null,
      reason: '需要数据分析',
      requestedCapabilities: ['cap-1'],
    }, 'client-key-1')).resolves.toMatchObject({
      requestId: 'request-1',
      status: 'PENDING',
      targetType: 'PLATFORM_EMPLOYEE',
      employee: { employeeId: 'emp-platform-1' },
    });
    expect(createRequest).toHaveBeenCalledWith(
      'user-1',
      { employeeId: 'emp-platform-1', reason: '需要数据分析' },
      expect.objectContaining({ targetType: 'PLATFORM_EMPLOYEE', idempotencyKey: 'client-key-1' }),
    );
  });

  it('returns only the authenticated user own access request status', async () => {
    const getClientRequest = (service as any).subscriptionRequests.getClientRequest;
    getClientRequest.mockResolvedValue({
      id: 'request-1',
      status: 'CANCELED',
      clientTargetType: 'ENTERPRISE_SUBSCRIPTION',
      employeeId: 'emp-1',
      employee: { id: 'emp-1', name: '员工' },
      subscriptionId: 'sub-1',
      requestedCapabilities: [],
      createdAt: new Date('2026-09-29T08:30:00.000Z'),
      updatedAt: new Date('2026-09-29T08:31:00.000Z'),
    });
    await expect(service.getEmployeeAccessRequest('user-1', 'request-1')).resolves.toMatchObject({
      requestId: 'request-1',
      status: 'CANCELLED',
      targetType: 'ENTERPRISE_SUBSCRIPTION',
    });
    expect(getClientRequest).toHaveBeenCalledWith('user-1', 'request-1');
  });

  it('refreshes an access token only for the matching active device', async () => {
    prisma.device.findUnique.mockResolvedValue({ userId: 'user-1', revokedAt: null });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'A', role: 'USER' });
    prisma.enterpriseMember.findFirst.mockResolvedValue({ enterprise: { id: 'ent-1', name: 'Acme' } });

    await expect(service.refreshAccessToken({ refreshToken: 'refresh-token' })).resolves.toMatchObject({
      accessToken: 'access-token', refreshToken: 'next-refresh', accessTokenExpiresIn: 3600,
      enterprise: { id: 'ent-1', name: 'Acme' },
    });
    expect(sessions.rotateRefreshToken).toHaveBeenCalledWith('refresh-token', 'DESKTOP');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', type: 'access' }),
      expect.objectContaining({ expiresIn: 3600 }),
    );
  });

  it('aggregates enterprise allowance and personal wallet for the client', async () => {
    const enterprise = {
      userId: 'user-1',
      limitCNY: '300.00',
      usedCNY: '35.4200',
      remainingCNY: '264.5800',
      topUpRemainingCNY: '50.00',
      totalRemainingCNY: '314.5800',
      resetAt: '2026-10-01T00:00:00.000Z',
    };
    const personal = {
      balanceCNY: '10.00',
      totalDepositCNY: '20.00',
      totalConsumeCNY: '10.00',
    };
    allowanceQuery.getOne.mockResolvedValue(enterprise);
    personalWallet.getView.mockResolvedValue(personal);

    await expect(service.getComputeBalance('user-1')).resolves.toEqual({
      enterprise,
      personal,
    });
    expect(allowanceQuery.getOne).toHaveBeenCalledWith('ent-1', 'user-1');
    expect(personalWallet.getView).toHaveBeenCalledWith('user-1');
  });

  it('returns a personal wallet balance without enterprise allowance for an unaffiliated user', async () => {
    const personal = {
      balanceCNY: '0.00',
      totalDepositCNY: '0.00',
      totalConsumeCNY: '0.00',
    };
    personalWallet.getView.mockResolvedValue(personal);

    const context = (service as any).enterpriseContext;
    context.resolveOrNull.mockResolvedValueOnce(null);

    await expect(service.getComputeBalance('user-2')).resolves.toEqual({
      enterprise: null,
      personal,
    });
    expect(allowanceQuery.getOne).not.toHaveBeenCalled();
    expect(personalWallet.getView).toHaveBeenCalledWith('user-2');
  });

  it('returns the current user avatar and the server-resolved enterprise logo', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      name: 'A',
      avatar: '/api/users/avatars/user-avatar.webp',
      role: 'USER',
    });
    prisma.enterpriseMember.findFirst.mockResolvedValue({
      enterprise: {
        id: 'ent-1',
        name: 'Acme',
        logo: '/api/enterprise/logos/acme-logo.png',
      },
    });

    await expect(service.getProfile('user-1')).resolves.toEqual({
      user: {
        id: 'user-1',
        email: 'a@example.com',
        name: 'A',
        avatar: '/api/users/avatars/user-avatar.webp',
        role: 'USER',
      },
      enterprise: {
        id: 'ent-1',
        name: 'Acme',
        logo: '/api/enterprise/logos/acme-logo.png',
      },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true, email: true, name: true, avatar: true, role: true },
    });
    expect(prisma.enterpriseMember.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'asc' },
      select: { enterprise: { select: { id: true, name: true, logo: true } } },
    });
  });

  it('returns null enterprise and nullable image fields for users without branding', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'b@example.com',
      name: null,
      avatar: null,
      role: 'USER',
    });
    prisma.enterpriseMember.findFirst.mockResolvedValue(null);

    await expect(service.getProfile('user-2')).resolves.toEqual({
      user: {
        id: 'user-2',
        email: 'b@example.com',
        name: null,
        avatar: null,
        role: 'USER',
      },
      enterprise: null,
    });
  });

  it('rejects a profile lookup when the authenticated user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.enterpriseMember.findFirst.mockResolvedValue(null);

    await expect(service.getProfile('deleted-user')).rejects.toThrow('User not found');
  });

  it('lists only authorized subscriptions, deduplicates grants, and returns effective models', async () => {
    prisma.employeeGrant.findMany.mockResolvedValue([
      { subscription: { id: 'sub-1', name: null, templateVersion: '1.0.0', status: 'ACTIVE', employeeId: 'emp-1', employee: { id: 'emp-1', name: 'Employee', avatar: null, version: '1.1.0' } } },
      { subscription: { id: 'sub-1', name: null, templateVersion: '1.0.0', status: 'ACTIVE', employeeId: 'emp-1', employee: { id: 'emp-1', name: 'Employee', avatar: null, version: '1.1.0' } } },
    ]);
    prisma.platformModel.findMany.mockResolvedValue([{ modelId: 'gpt-4o-mini' }, { modelId: 'blocked-model' }]);
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue({ allowedChatModels: ['gpt-4o-mini'] });

    const result = await service.listSubscriptions('user-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ subscriptionId: 'sub-1', employeeId: 'emp-1', allowedModels: ['gpt-4o-mini'], upgradeAvailable: true });
    expect(prisma.employeeGrant.findMany.mock.calls[0][0].where).toMatchObject({
      OR: [{ memberId: 'member-1' }, { departmentId: 'dept-1' }],
      subscription: { enterpriseId: 'ent-1', status: 'ACTIVE' },
    });
  });

  it('returns the same versioned avatar in client list and runtime without exposing extra employee fields', async () => {
    const employee = {
      id: 'emp-1', name: 'Renamed employee',
      avatar: '/assets/employees/silicon/frontend-engineer.webp',
      version: '1.0.0', description: 'Engineer', maxSteps: 10,
      systemPrompt: 'private instructions', modelId: 'model-1', bindings: [],
    };
    const sub = { id: 'sub-1', employeeId: employee.id, name: 'Enterprise alias', templateVersion: '1.0.0', status: 'ACTIVE', employee, skillVersionSelections: [] };
    prisma.employeeGrant.findMany.mockResolvedValue([{ subscription: sub }]);
    prisma.subscription.findFirst.mockResolvedValue(sub);
    prisma.platformModel.findMany.mockResolvedValue([]);
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue(null);

    const [listed] = await service.listSubscriptions('user-1');
    const runtime = await service.getRuntime('user-1', 'sub-1');
    const expected = withEmployeeAvatar(employee);
    expect(listed.template.avatarAsset).toEqual(expected.avatarAsset);
    expect(runtime.employee.avatarAsset).toEqual(expected.avatarAsset);
    expect(listed.template.avatar).toBe(expected.avatarAsset.portraitUrl);
    expect(runtime.employee).not.toHaveProperty('systemPrompt');
    expect(runtime.employee).not.toHaveProperty('bindings');
  });
});

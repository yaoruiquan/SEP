import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClientService } from './client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { SettingService } from '../setting/setting.service';
import { JwtService } from '@nestjs/jwt';
import { withEmployeeAvatar } from '../../common/employee-avatar';

describe('ClientService', () => {
  let service: ClientService;
  let prisma: any;
  let jwt: any;

  beforeEach(async () => {
    prisma = {
      device: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      enterpriseMember: { findFirst: jest.fn() },
      employeeGrant: { findMany: jest.fn(), findFirst: jest.fn() },
      platformModel: { findMany: jest.fn() },
      enterpriseModelConfig: { findUnique: jest.fn() },
      subscription: { findFirst: jest.fn() },
    };
    jwt = { sign: jest.fn().mockReturnValue('access-token'), verify: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ClientService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn(), getOrThrow: jest.fn().mockReturnValue('explicit-test-jwt-secret') } },
        { provide: SettingService, useValue: { getEffectiveValue: jest.fn() } },
        {
          provide: EnterpriseContextService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({
              enterpriseId: 'ent-1', memberId: 'member-1', departmentId: 'dept-1', role: 'MEMBER',
            }),
          },
        },
      ],
    }).compile();
    service = module.get(ClientService);
  });

  it('refreshes an access token only for the matching active device', async () => {
    jwt.verify.mockReturnValue({ sub: 'user-1', deviceId: 'device-1', type: 'client-refresh' });
    prisma.device.findUnique.mockResolvedValue({ userId: 'user-1', revokedAt: null });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'A', role: 'USER' });
    prisma.enterpriseMember.findFirst.mockResolvedValue({ enterprise: { id: 'ent-1', name: 'Acme' } });

    await expect(service.refreshAccessToken({ refreshToken: 'refresh-token' })).resolves.toMatchObject({
      accessToken: 'access-token', accessTokenExpiresIn: 3600,
      enterprise: { id: 'ent-1', name: 'Acme' },
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', type: 'access' }),
      expect.objectContaining({ expiresIn: 3600 }),
    );
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

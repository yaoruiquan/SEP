import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SkillVersionService } from './skill-version.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

const memberContext = {
  enterpriseId: 'enterprise-1',
  memberId: 'member-1',
  departmentId: 'department-1',
  role: 'MEMBER' as const,
};

const adminContext = { ...memberContext, role: 'ENTERPRISE_ADMIN' as const };

const platformVersion = {
  id: 'version-platform',
  capabilityId: 'capability-1',
  scope: 'PLATFORM',
  enterpriseId: null,
  parentVersionId: null,
  sourceVersionId: null,
  version: '1.0.0',
  content: '# Approved skill',
  changeSummary: null,
  status: 'PLATFORM_APPROVED',
  createdAt: new Date(),
  updatedAt: new Date(),
  capability: { id: 'capability-1', name: 'Skill', description: 'Description' },
};

function createPrismaMock() {
  const prisma = {
    skillVersion: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    skillVersionReview: { create: jest.fn() },
    subscription: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      // publishEnterpriseVersion 在事务里查「哪些雇佣关系要切到新版」
      findMany: jest.fn().mockResolvedValue([]),
    },
    capability: { findUnique: jest.fn().mockResolvedValue({ name: '测试能力' }) },
    enterpriseMember: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { createMany: jest.fn() },
    employeeCapabilityBinding: { findFirst: jest.fn() },
    subscriptionSkillVersion: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) => callback(prisma));
  return prisma;
}

describe('SkillVersionService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let enterpriseContext: {
    resolve: jest.Mock;
    assertCanApprove: jest.Mock;
    assertEnterpriseAdmin: jest.Mock;
  };
  let service: SkillVersionService;

  beforeEach(() => {
    prisma = createPrismaMock();
    enterpriseContext = {
      resolve: jest.fn().mockResolvedValue(memberContext),
      assertCanApprove: jest.fn(),
      assertEnterpriseAdmin: jest.fn(),
    };
    service = new SkillVersionService(
      prisma as unknown as PrismaService,
      enterpriseContext as unknown as EnterpriseContextService,
    );
  });

  it('denies preview when the member has no active granted subscription', async () => {
    prisma.skillVersion.findUnique.mockResolvedValue(platformVersion);
    prisma.subscription.findFirst.mockResolvedValue(null);

    await expect(service.previewEnterpriseVersion('user-1', platformVersion.id)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('hides another enterprise private version', async () => {
    prisma.skillVersion.findUnique.mockResolvedValue({
      ...platformVersion,
      scope: 'ENTERPRISE',
      enterpriseId: 'enterprise-2',
      status: 'ENTERPRISE_APPROVED',
    });

    await expect(service.previewEnterpriseVersion('user-1', 'private-version')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('hides a platform version before platform approval', async () => {
    prisma.skillVersion.findUnique.mockResolvedValue({
      ...platformVersion,
      status: 'PENDING_PLATFORM_REVIEW',
    });

    await expect(service.previewEnterpriseVersion('user-1', 'pending-version')).rejects.toThrow(
      NotFoundException,
    );
  });

  // 企业内提审流已下线（会议纪要2 §6.4），取代它的是「发布并生效」一步。
  // 这里守住的仍是同一条边界：普通成员不能让一个企业版生效。
  it('does not allow an ordinary member to publish an enterprise version', async () => {
    enterpriseContext.assertEnterpriseAdmin.mockImplementation(() => {
      throw new ForbiddenException('仅企业管理员可执行此操作');
    });

    await expect(service.publishEnterpriseVersion('user-1', 'version-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
  });

  it('does not allow selecting an unapproved version', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'subscription-1',
      employeeId: 'employee-1',
      enterpriseId: 'enterprise-1',
    });
    prisma.employeeCapabilityBinding.findFirst.mockResolvedValue({ id: 'binding-1' });
    prisma.skillVersion.findUnique.mockResolvedValue({
      ...platformVersion,
      status: 'PENDING_PLATFORM_REVIEW',
    });

    await expect(
      service.selectVersion(
        'admin-1',
        'subscription-1',
        'capability-1',
        platformVersion.id,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
  });

  it('allows an enterprise-rejected version to be edited again', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'rejected-version',
      enterpriseId: 'enterprise-1',
      scope: 'ENTERPRISE',
      parentVersionId: 'parent-version',
      status: 'ENTERPRISE_REJECTED',
    });
    prisma.skillVersion.update.mockResolvedValue({ id: 'rejected-version' });

    await service.updateEnterpriseVersion('user-1', 'rejected-version', {
      content: '# Revised skill',
      changeSummary: '修正审核意见中的步骤说明',
    });

    expect(prisma.skillVersion.update).toHaveBeenCalled();
  });

  it('refuses to publish an already-approved version', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'approved-version',
      capabilityId: 'capability-1',
      status: 'ENTERPRISE_APPROVED',
      version: '1.1.0',
    });

    await expect(service.publishEnterpriseVersion('user-1', 'approved-version')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });

  // 提审流删掉后，存量卡在「待企业审核」的版本必须还有出路 ——
  // 不接受它们等于把那些数据永久锁死在界面上
  it('accepts a legacy PENDING_ENTERPRISE_REVIEW version for publishing', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'legacy-version',
      capabilityId: 'capability-1',
      status: 'PENDING_ENTERPRISE_REVIEW',
      version: '1.0.2',
    });

    await expect(
      service.publishEnterpriseVersion('user-1', 'legacy-version'),
    ).resolves.toBeDefined();
  });

  it('creates a platform review copy without changing the enterprise source version', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    const enterpriseVersion = {
      ...platformVersion,
      id: 'enterprise-version',
      scope: 'ENTERPRISE',
      enterpriseId: 'enterprise-1',
      status: 'ENTERPRISE_APPROVED',
    };
    prisma.skillVersion.findFirst.mockResolvedValue(enterpriseVersion);
    prisma.skillVersion.findUnique.mockResolvedValue(null);
    prisma.skillVersion.findMany.mockResolvedValue([]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'platform-copy' });

    await service.submitPlatformReview('admin-1', enterpriseVersion.id);

    expect(prisma.skillVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: 'PLATFORM',
          sourceVersionId: enterpriseVersion.id,
          status: 'PENDING_PLATFORM_REVIEW',
          content: enterpriseVersion.content,
        }),
      }),
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });

  it('rejects only the platform copy and leaves the enterprise source untouched', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      ...platformVersion,
      id: 'platform-copy',
      sourceVersionId: 'enterprise-version',
      status: 'PENDING_PLATFORM_REVIEW',
    });
    prisma.skillVersion.update.mockResolvedValue({ id: 'platform-copy' });

    await service.reviewPlatformVersion('platform-admin', 'platform-copy', {
      decision: 'REJECT',
      comment: 'Needs changes',
    });

    expect(prisma.skillVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'platform-copy' },
        data: expect.objectContaining({ status: 'PLATFORM_REJECTED' }),
      }),
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'enterprise-version' } }),
    );
  });
});

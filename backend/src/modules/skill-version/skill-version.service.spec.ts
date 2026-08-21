import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    },
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

  it('does not allow an ordinary member to perform enterprise review', async () => {
    enterpriseContext.assertCanApprove.mockImplementation(() => {
      throw new ForbiddenException('仅企业管理员可审批');
    });

    await expect(
      service.reviewEnterpriseVersion('user-1', 'version-1', { decision: 'APPROVE' }),
    ).rejects.toThrow(ForbiddenException);
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

  it('requires a change description before submitting a derived version', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'draft-version',
      enterpriseId: 'enterprise-1',
      scope: 'ENTERPRISE',
      parentVersionId: 'parent-version',
      changeSummary: '   ',
      status: 'DRAFT',
    });

    await expect(service.submitEnterpriseReview('user-1', 'draft-version')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
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

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
      count: jest.fn().mockResolvedValue(0),
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
    employeeCapabilityBinding: {
      findFirst: jest.fn(),
      // 「发布为平台版」要把员工模板钉着的默认版推到新版本，否则那个动作没有任何效果
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
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
  // ──────────── 运营主动采纳企业版本 ────────────
  //
  // 这条路径的存在理由：会议纪要2 §6 的阶梯顶端写的是「采纳与否由平台自己决定
  // （数据本身都在平台）」。在它补上之前，唯一的上行入口是企业管理员投稿，
  // 运营在企业版本列表里只能看。

  const enterpriseSource = {
    ...platformVersion,
    id: 'enterprise-version',
    scope: 'ENTERPRISE',
    enterpriseId: 'enterprise-1',
    status: 'ENTERPRISE_APPROVED',
    version: '1.0.3',
    changeSummary: '加术语表',
    parentVersionId: 'version-platform',
    packageKey: 'skills/abc.zip',
    packageSha256: 'abc',
    packageFileCount: 3,
    packageFilename: 'ui-designer.zip',
    enterprise: { name: '示例科技有限公司' },
  };

  it('adopts an enterprise version as a pending platform copy and leaves the source alone', async () => {
    prisma.skillVersion.findFirst
      .mockResolvedValueOnce(enterpriseSource)
      .mockResolvedValueOnce({ id: 'platform-head' });
    prisma.skillVersion.findUnique.mockResolvedValue(null);
    prisma.skillVersion.findMany.mockResolvedValue([{ version: '1.0.0' }]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'platform-copy' });

    await service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, {
      mode: 'DRAFT',
    });

    expect(prisma.skillVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: 'PLATFORM',
          sourceVersionId: enterpriseSource.id,
          // 平台谱系的父版本是平台自己的头部，不是企业版的父版本
          parentVersionId: 'platform-head',
          status: 'PENDING_PLATFORM_REVIEW',
          content: enterpriseSource.content,
          // 包字段要跟着正文走，否则平台版拿不到可下载的原始 zip
          packageKey: 'skills/abc.zip',
          packageSha256: 'abc',
          changeSummary: '平台采纳 示例科技有限公司 的 v1.0.3 —— 加术语表',
        }),
      }),
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    // 待审状态还没进市场，不该动员工模板的默认版
    expect(prisma.employeeCapabilityBinding.updateMany).not.toHaveBeenCalled();
    expect(prisma.skillVersionReview.create).not.toHaveBeenCalled();
  });

  it('publishes an adopted version and advances the pinned platform defaults', async () => {
    prisma.skillVersion.findFirst
      .mockResolvedValueOnce(enterpriseSource)
      .mockResolvedValueOnce(null);
    prisma.skillVersion.findUnique.mockResolvedValue(null);
    prisma.skillVersion.findMany.mockResolvedValue([]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'platform-copy' });

    await service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, {
      mode: 'PUBLISH',
      changeSummary: '这一版的检查清单值得所有企业用',
    });

    expect(prisma.skillVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PLATFORM_APPROVED',
          platformReviewedById: 'platform-admin',
          changeSummary: '这一版的检查清单值得所有企业用',
        }),
      }),
    );
    // 少了这一步，「直接发布」是个看不出效果的空动作：绑定还钉在旧平台版上
    expect(prisma.employeeCapabilityBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          capabilityId: enterpriseSource.capabilityId,
          defaultSkillVersion: { scope: 'PLATFORM' },
        }),
        data: { defaultSkillVersionId: 'platform-copy' },
      }),
    );
    // 跳过审核也要留审核记录，否则「谁把这一版放进平台的」查不到
    expect(prisma.skillVersionReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorType: 'PLATFORM', decision: 'APPROVE' }),
      }),
    );
  });

  it('refuses to adopt the same enterprise version twice', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue(enterpriseSource);
    prisma.skillVersion.findUnique.mockResolvedValue({ version: '1.0.1', status: 'PLATFORM_APPROVED' });

    await expect(
      service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, { mode: 'DRAFT' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
  });

  it('refuses to adopt a version the enterprise already archived', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({ ...enterpriseSource, status: 'ARCHIVED' });

    await expect(
      service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, { mode: 'PUBLISH' }),
    ).rejects.toThrow(ConflictException);
  });

  it('adopts an enterprise draft — 运营看的是正文，不是企业内部走到哪一步', async () => {
    prisma.skillVersion.findFirst
      .mockResolvedValueOnce({ ...enterpriseSource, status: 'DRAFT' })
      .mockResolvedValueOnce(null);
    prisma.skillVersion.findUnique.mockResolvedValue(null);
    prisma.skillVersion.findMany.mockResolvedValue([]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'platform-copy' });

    await expect(
      service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, { mode: 'DRAFT' }),
    ).resolves.toBeDefined();
  });

  it('advances platform defaults when a submitted version passes review', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      ...platformVersion,
      id: 'platform-copy',
      status: 'PENDING_PLATFORM_REVIEW',
    });
    prisma.skillVersion.update.mockResolvedValue({ id: 'platform-copy' });

    await service.reviewPlatformVersion('platform-admin', 'platform-copy', {
      decision: 'APPROVE',
    });

    expect(prisma.employeeCapabilityBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultSkillVersionId: 'platform-copy' } }),
    );
  });

  it('keeps personal copies out of the platform review list', async () => {
    await expect(
      service.listAdminVersions({ scope: 'PERSONAL', page: 1, limit: 20 }),
    ).rejects.toThrow(BadRequestException);

    prisma.skillVersion.findMany.mockResolvedValue([]);
    await service.listAdminVersions({ page: 1, limit: 20 });

    expect(prisma.skillVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scope: { in: ['PLATFORM', 'ENTERPRISE'] } },
      }),
    );
  });
});

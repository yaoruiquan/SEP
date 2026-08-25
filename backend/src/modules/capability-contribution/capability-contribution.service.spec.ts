import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CapabilityContributionService } from './capability-contribution.service';
import { CapabilityValidatorService } from './capability-validator.service';

describe('CapabilityContributionService', () => {
  const capability = {
    id: 'cap-1',
    name: '销售分析',
    description: '分析销售数据',
    type: 'SKILL',
    enterpriseId: 'enterprise-1',
    contributorId: 'user-1',
    enterpriseReviewStatus: 'NOT_SUBMITTED',
    platformReviewStatus: 'NOT_SUBMITTED',
    visibility: 'ENTERPRISE_PRIVATE',
    status: 'PENDING',
  } as any;

  const enterpriseContext = {
    resolveOrNull: jest.fn(),
    resolve: jest.fn(),
    assertCanApprove: jest.fn(),
    assertEnterpriseAdmin: jest.fn(),
  };
  const prisma = {
    capability: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    skillVersion: { updateMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    agentConfig: { findUnique: jest.fn() },
    contributionRewardEvent: { createMany: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const validator = new CapabilityValidatorService();
  const service = new CapabilityContributionService(prisma as never, enterpriseContext as never, validator);

  beforeEach(() => {
    jest.resetAllMocks();
    enterpriseContext.assertCanApprove.mockImplementation(() => undefined);
    enterpriseContext.assertEnterpriseAdmin.mockImplementation(() => undefined);
    enterpriseContext.resolveOrNull.mockResolvedValue({ enterpriseId: 'enterprise-1', role: 'MEMBER' });
    enterpriseContext.resolve.mockResolvedValue({ enterpriseId: 'enterprise-1', role: 'MEMBER' });
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    prisma.capability.create.mockResolvedValue(capability);
    prisma.capability.findFirst.mockResolvedValue(capability);
    prisma.capability.update.mockResolvedValue(capability);
    prisma.skillVersion.updateMany.mockResolvedValue({ count: 1 });
    prisma.contributionRewardEvent.createMany.mockResolvedValue({ count: 1 });
  });

  it('automatically binds an enterprise member contribution to the resolved enterprise', async () => {
    await service.create('user-1', {
      name: '销售分析',
      description: '分析销售数据',
      type: 'skill',
      industry: ['零售'],
      position: ['数据分析'],
      inputSchema: {},
      outputSchema: {},
      skillConfig: { template: '分析 {{data}}', modelId: 'model-1', temperature: 0.2, maxTokens: 512 },
    });

    expect(prisma.capability.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contributorId: 'user-1', enterpriseId: 'enterprise-1' }),
    }));
  });

  it('lets an enterprise admin inspect another member contribution in the same enterprise', async () => {
    enterpriseContext.resolveOrNull.mockResolvedValue({ enterpriseId: 'enterprise-1', role: 'ENTERPRISE_ADMIN' });
    prisma.capability.findFirst.mockResolvedValue({ ...capability, contributorId: 'member-2' });

    await service.getOne('admin-1', 'cap-1');

    expect(prisma.capability.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cap-1', OR: [{ contributorId: 'admin-1' }, { enterpriseId: 'enterprise-1' }] },
    }));
  });

  it('lists only platform-authorized submissions in the operator queue', async () => {
    prisma.capability.findMany.mockResolvedValue([capability]);
    prisma.capability.count.mockResolvedValue(1);

    const result = await service.listPlatformQueue();

    expect(result).toEqual(expect.objectContaining({ total: 1, status: 'PENDING_REVIEW' }));
    expect(prisma.capability.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { platformReviewStatus: 'PENDING_REVIEW' },
    }));
    expect(prisma.capability.count).toHaveBeenCalledWith({ where: { platformReviewStatus: 'PENDING_REVIEW' } });
  });

  it('does not allow a non-admin enterprise member to review', async () => {
    enterpriseContext.assertCanApprove.mockImplementation(() => { throw new ForbiddenException('仅企业管理员可审批'); });
    await expect(service.reviewEnterprise('user-2', 'cap-1', { decision: 'APPROVE' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(enterpriseContext.assertCanApprove).toHaveBeenCalled();
    expect(prisma.capability.findFirst).not.toHaveBeenCalled();
  });

  it('blocks enterprise submission when the Skill does not pass automatic validation', async () => {
    prisma.capability.findFirst.mockResolvedValue({ ...capability, enterpriseReviewStatus: 'NOT_SUBMITTED' });
    prisma.skillVersion.findFirst.mockResolvedValue({ content: '只有一段没有结构的正文' });

    await expect(service.submitEnterpriseReview('user-1', 'cap-1')).rejects.toThrow('自动校验未通过');
    expect(prisma.capability.update).not.toHaveBeenCalled();
  });

  it('persists validation results before moving a valid Skill into enterprise review', async () => {
    prisma.capability.findFirst.mockResolvedValue({ ...capability, enterpriseReviewStatus: 'NOT_SUBMITTED' });
    prisma.skillVersion.findFirst.mockResolvedValue({ content: '# 角色\n数据分析师\n# 输入\n销售数据\n# 步骤\n分析趋势\n# 输出\n报告' });

    await service.submitEnterpriseReview('user-1', 'cap-1');

    expect(prisma.capability.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ enterpriseReviewStatus: 'PENDING', validationResult: expect.objectContaining({ valid: true }) }),
    }));
    expect(prisma.skillVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING_ENTERPRISE_REVIEW', validationResult: expect.objectContaining({ valid: true }) }),
    }));
  });

  it('validates a personal PLATFORM draft before direct platform submission', async () => {
    prisma.capability.findFirst.mockResolvedValue({
      ...capability,
      enterpriseId: null,
      enterpriseReviewStatus: 'NOT_SUBMITTED',
      platformReviewStatus: 'NOT_SUBMITTED',
    });
    prisma.skillVersion.findFirst.mockResolvedValue({ content: '# 角色\n验收助手\n# 输入\n页面截图\n# 步骤\n检查页面\n# 输出\n验收报告' });

    await service.requestPlatformReview('user-1', 'cap-1');

    expect(prisma.skillVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        capabilityId: 'cap-1',
        status: { in: ['DRAFT', 'ENTERPRISE_REJECTED', 'ENTERPRISE_APPROVED', 'PLATFORM_REJECTED'] },
      }),
    }));
    expect(prisma.capability.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ platformReviewStatus: 'PENDING_REVIEW', platformSubmittedById: 'user-1' }),
    }));
    expect(prisma.skillVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ scope: 'PLATFORM', status: { in: ['DRAFT', 'PLATFORM_REJECTED'] } }),
    }));
  });

  it('keeps personal Skill iterations in the PLATFORM scope', async () => {
    enterpriseContext.resolveOrNull.mockResolvedValue(null);
    prisma.capability.findFirst.mockResolvedValue({
      ...capability,
      enterpriseId: null,
      visibility: 'ENTERPRISE_PRIVATE',
      type: 'SKILL',
    });
    prisma.skillVersion.count.mockResolvedValue(1);
    prisma.skillVersion.create.mockResolvedValue({
      id: 'version-2',
      capabilityId: 'cap-1',
      scope: 'PLATFORM',
      enterpriseId: null,
      parentVersionId: null,
      version: '1.0.1',
      changeSummary: '补充输出示例',
      status: 'DRAFT',
      createdAt: new Date(),
    });

    await service.createSkillVersion('user-1', 'cap-1', {
      content: '# 角色\n验收助手\n# 输入\n页面\n# 步骤\n检查\n# 输出\n报告',
      changeSummary: '补充输出示例',
    });

    expect(prisma.skillVersion.count).toHaveBeenCalledWith({
      where: { capabilityId: 'cap-1', scope: 'PLATFORM', enterpriseId: null },
    });
    expect(prisma.skillVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ capabilityId: 'cap-1', scope: 'PLATFORM', enterpriseId: null, status: 'DRAFT' }),
    }));
  });

  it('moves a submitted capability through enterprise review and creates a deduplicated reward event', async () => {
    enterpriseContext.resolve.mockResolvedValue({ enterpriseId: 'enterprise-1', role: 'ENTERPRISE_ADMIN' });
    prisma.capability.findFirst
      .mockResolvedValueOnce({ ...capability, enterpriseReviewStatus: 'PENDING' })
      .mockResolvedValueOnce({ ...capability, enterpriseReviewStatus: 'PENDING' });

    await service.reviewEnterprise('admin-1', 'cap-1', { decision: 'APPROVE' });

    expect(prisma.capability.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ enterpriseReviewStatus: 'APPROVED', enterpriseReviewedById: 'admin-1' }),
    }));
    expect(prisma.contributionRewardEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({ dedupeKey: 'enterprise-approved:cap-1', points: 10 })],
    }));
  });

  it('requires enterprise approval before the creator can request platform review', async () => {
    prisma.capability.findFirst.mockResolvedValue({ ...capability, enterpriseReviewStatus: 'PENDING' });
    await expect(service.requestPlatformReview('user-1', 'cap-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.capability.update).not.toHaveBeenCalled();
  });

  it('lets an enterprise admin authorize the creator request into the platform queue', async () => {
    enterpriseContext.resolve.mockResolvedValue({ enterpriseId: 'enterprise-1', role: 'ENTERPRISE_ADMIN' });
    prisma.capability.findFirst.mockResolvedValue({
      ...capability,
      enterpriseReviewStatus: 'APPROVED',
      platformReviewStatus: 'REQUESTED',
    });

    await service.authorizePlatformSubmission('admin-1', 'cap-1');

    expect(prisma.capability.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ platformReviewStatus: 'PENDING_REVIEW', platformSubmittedById: 'admin-1' }),
    }));
  });

  it('publishes only after platform admin approval and awards the contributor once', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.capability.findUnique.mockResolvedValue({
      ...capability,
      platformReviewStatus: 'PENDING_REVIEW',
    });

    await service.reviewPlatform('platform-admin', 'cap-1', { decision: 'APPROVE' });

    expect(prisma.capability.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ platformReviewStatus: 'APPROVED', visibility: 'MARKET_PUBLIC', status: 'APPROVED' }),
    }));
    expect(prisma.contributionRewardEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({ dedupeKey: 'platform-approved:cap-1', points: 50 })],
    }));
    expect(prisma.skillVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { capabilityId: 'cap-1', status: 'PENDING_PLATFORM_REVIEW' },
      data: expect.objectContaining({ status: 'PLATFORM_APPROVED' }),
    }));
  });

  it('rejects a second platform review after the first review has completed', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.capability.findUnique.mockResolvedValue({ ...capability, platformReviewStatus: 'APPROVED' });
    await expect(service.reviewPlatform('platform-admin', 'cap-1', { decision: 'APPROVE' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.contributionRewardEvent.createMany).not.toHaveBeenCalled();
  });
});

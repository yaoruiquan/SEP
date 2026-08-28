import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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
    skillVersion: { updateMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    agentConfig: { findUnique: jest.fn() },
    contributionRewardEvent: { createMany: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const validator = new CapabilityValidatorService();
  const skillPackage = { read: jest.fn(), store: jest.fn(), resolveStoredPath: jest.fn() };
  const service = new CapabilityContributionService(
    prisma as never,
    enterpriseContext as never,
    validator,
    skillPackage as never,
  );

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

  it('takes the first version body from the uploaded package, not from the client', async () => {
    // 客户端同时送来 packageSha256 与一段正文。DTO 层本就二选一，这里额外
    // 确认服务端只认按 sha256 重读的那份 —— 否则可以拿 A 包的哈希配 B 包的
    // 正文，绕过上传时跑过的自动校验。
    skillPackage.read.mockResolvedValue({
      key: 'skills/aa.zip',
      sha256: 'a'.repeat(64),
      fileCount: 3,
      totalBytes: 2048,
      content: '# 角色\n包里的正文',
      suggested: { name: null, description: null },
    });

    await service.create('user-1', {
      name: '竞品周报',
      description: '生成竞品周报',
      type: 'skill',
      industry: [],
      position: [],
      inputSchema: {},
      outputSchema: {},
      skillConfig: {
        packageSha256: 'a'.repeat(64),
        packageFilename: '竞品周报.zip',
        template: '客户端伪造的正文，不应被采纳',
      },
    } as never);

    expect(skillPackage.read).toHaveBeenCalledWith('a'.repeat(64));
    const { data } = prisma.capability.create.mock.calls[0][0];
    expect(data.skillVersions.create).toMatchObject({
      content: '# 角色\n包里的正文',
      version: '1.0.0',
      status: 'DRAFT',
      packageKey: 'skills/aa.zip',
      packageSha256: 'a'.repeat(64),
      packageFileCount: 3,
      packageFilename: '竞品周报.zip',
    });
    // SkillConfig.template 与首版正文同源，两处不会漂移
    expect(data.skillConfig.create.template).toBe('# 角色\n包里的正文');
  });

  it('keeps hand-written drafts free of package fields', async () => {
    await service.create('user-1', {
      name: '手写能力',
      description: '在线编写的正文',
      type: 'skill',
      industry: [],
      position: [],
      inputSchema: {},
      outputSchema: {},
      skillConfig: { template: '---\nname: x\n---\n# 角色\n手写正文' },
    });

    expect(skillPackage.read).not.toHaveBeenCalled();
    const { data } = prisma.capability.create.mock.calls[0][0];
    // frontmatter 被剥掉，正文从第一个标题开始
    expect(data.skillVersions.create.content).toBe('# 角色\n手写正文');
    expect(data.skillVersions.create.packageKey).toBeUndefined();
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

  it('merges capability and Skill version submissions into one oldest-first queue', async () => {
    const capabilitySubmittedAt = new Date('2026-08-25T10:00:00.000Z');
    const versionSubmittedAt = new Date('2026-08-25T09:00:00.000Z');
    prisma.capability.findMany.mockResolvedValue([{
      id: 'cap-1', name: '销售分析', type: 'SKILL', platformReviewStatus: 'PENDING_REVIEW',
      platformSubmittedAt: capabilitySubmittedAt, enterprise: { id: 'ent-1', name: '示例企业' },
      platformSubmittedBy: { id: 'admin-1', name: '企业管理员', email: 'admin@example.com' },
      contributor: { id: 'user-1', name: '贡献者', email: 'user@example.com' },
    }]);
    prisma.skillVersion.findMany.mockResolvedValue([{
      id: 'version-1', capabilityId: 'cap-1', version: '1.1.0', status: 'PENDING_PLATFORM_REVIEW',
      submittedAt: versionSubmittedAt, capability: { name: '销售分析' }, enterprise: { id: 'ent-1', name: '示例企业' },
      createdBy: { id: 'user-1', name: '贡献者', email: 'user@example.com' },
    }]);

    const result = await service.listUnifiedReviewQueue();

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.kind)).toEqual(['SKILL_VERSION', 'CAPABILITY']);
    expect(result.items[1].submittedBy.email).toBe('admin@example.com');
    expect(prisma.capability.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platformReviewStatus: 'PENDING_REVIEW' } }));
    expect(prisma.skillVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING_PLATFORM_REVIEW' } }));
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
    // 父版本回落：先查本作用域最新的版本
    prisma.skillVersion.findFirst.mockResolvedValue({ id: 'version-1' });
    prisma.skillVersion.findMany.mockResolvedValue([{ version: '1.0.0' }]);
    prisma.skillVersion.create.mockResolvedValue({
      id: 'version-2',
      capabilityId: 'cap-1',
      scope: 'PLATFORM',
      enterpriseId: null,
      parentVersionId: 'version-1',
      version: '1.0.1',
      changeSummary: '补充输出示例',
      status: 'DRAFT',
      createdAt: new Date(),
    });

    await service.createSkillVersion('user-1', 'cap-1', {
      content: '# 角色\n验收助手\n# 输入\n页面\n# 步骤\n检查\n# 输出\n报告',
      changeSummary: '补充输出示例',
    });

    expect(prisma.skillVersion.findMany).toHaveBeenCalledWith({
      where: { capabilityId: 'cap-1', scope: 'PLATFORM', enterpriseId: null },
      select: { version: true },
    });
    expect(prisma.skillVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        capabilityId: 'cap-1', scope: 'PLATFORM', enterpriseId: null, status: 'DRAFT',
        // 版本号走统一的 semver 规则，不再是 `1.0.${count}`
        version: '1.0.1', parentVersionId: 'version-1',
      }),
    }));
  });

  it('lets the author iterate a capability that is already public', async () => {
    // 从前这里直接抛 Conflict —— 能力一旦公开，作者就再也发不出新版本。
    enterpriseContext.resolveOrNull.mockResolvedValue({ enterpriseId: 'enterprise-1', role: 'MEMBER' });
    prisma.capability.findFirst.mockResolvedValue({
      ...capability,
      visibility: 'MARKET_PUBLIC',
      platformReviewStatus: 'APPROVED',
      type: 'SKILL',
    });
    // 本企业还没有任何版本，父版本回落到当前公开的平台版本
    prisma.skillVersion.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'public-version' });
    prisma.skillVersion.findMany.mockResolvedValue([]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'version-3' });

    await service.createSkillVersion('user-1', 'cap-1', {
      content: '# 角色\n验收助手\n# 输入\n页面\n# 步骤\n检查\n# 输出\n报告',
      changeSummary: '公开后的第一次迭代',
    });

    expect(prisma.skillVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scope: 'ENTERPRISE',
        parentVersionId: 'public-version',
        // 本企业第一个版本，从 1.0.0 起
        version: '1.0.0',
        status: 'DRAFT',
      }),
    }));
  });

  it('routes version submission by scope and gates it on validation', async () => {
    const validBody = '# 角色\n验收助手\n# 输入\n页面\n# 步骤\n检查\n# 输出\n报告';
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'version-2', scope: 'PLATFORM', status: 'DRAFT',
      changeSummary: '补充输出示例', content: validBody,
    });
    prisma.skillVersion.update.mockResolvedValue({ id: 'version-2' });

    await service.submitVersion('user-1', 'version-2');

    // 个人版本直投平台
    expect(prisma.skillVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'version-2' },
      data: expect.objectContaining({ status: 'PENDING_PLATFORM_REVIEW', rejectionReason: null }),
    }));
  });

  it('sends enterprise-scope versions to the enterprise reviewer first', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'version-2', scope: 'ENTERPRISE', status: 'ENTERPRISE_REJECTED',
      changeSummary: '按驳回意见补充边界条件',
      content: '# 角色\n验收助手\n# 输入\n页面\n# 步骤\n检查\n# 输出\n报告',
    });
    prisma.skillVersion.update.mockResolvedValue({ id: 'version-2' });

    await service.submitVersion('user-1', 'version-2');

    expect(prisma.skillVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING_ENTERPRISE_REVIEW' }),
    }));
  });

  it('refuses to submit a version whose body fails validation', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'version-2', scope: 'PLATFORM', status: 'DRAFT',
      changeSummary: '改了点东西', content: '# 角色\n只有角色一段',
    });

    await expect(service.submitVersion('user-1', 'version-2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });

  it('refuses to submit a version without a change summary', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'version-2', scope: 'PLATFORM', status: 'DRAFT',
      changeSummary: '   ',
      content: '# 角色\n验收助手\n# 输入\n页面\n# 步骤\n检查\n# 输出\n报告',
    });

    await expect(service.submitVersion('user-1', 'version-2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to rewrite the body of a version that came from a package', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'version-2', scope: 'PLATFORM', status: 'DRAFT',
      packageKey: 'skills/aa.zip', content: '包里的正文',
    });

    await expect(
      service.updateVersion('user-1', 'version-2', { content: 'x'.repeat(30) }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to touch a version that is already under review', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'version-2', scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW',
    });

    await expect(service.submitVersion('user-1', 'version-2')).rejects.toBeInstanceOf(
      ConflictException,
    );
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

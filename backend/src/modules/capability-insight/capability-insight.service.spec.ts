import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CapabilityInsightService } from './capability-insight.service';

describe('CapabilityInsightService SKILL write closure', () => {
  const ctx = { enterpriseId: 'enterprise-1', role: 'ENTERPRISE_ADMIN' };
  const pending = {
    id: 'insight-1', enterpriseId: 'enterprise-1', capabilityId: 'skill-1',
    status: 'PENDING', scope: 'ALL', findings: [],
  };
  const prisma = {
    capabilityInsight: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    capability: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
    toolExecution: { findMany: jest.fn() },
    skillVersion: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const enterpriseContext = { resolve: jest.fn(), assertEnterpriseAdmin: jest.fn() };
  const skillVersions = { createEnterpriseVersionFromContent: jest.fn(), resolveEffectiveVersion: jest.fn() };
  const config = { get: jest.fn() };
  const service = new CapabilityInsightService(
    prisma as never, enterpriseContext as never, skillVersions as never,
    config as never, {} as never, {} as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    enterpriseContext.resolve.mockResolvedValue(ctx);
    prisma.capabilityInsight.findFirst.mockResolvedValue(pending);
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects edited AI adoption before generating a version or consuming the pending suggestion', async () => {
    await expect(service.adopt('admin-1', 'insight-1', {
      content: '# 角色\n管理员修改的正文', changeSummary: '采纳 AI 建议',
    })).rejects.toThrow('AI 建议正文采纳已停用');
    expect(prisma.capabilityInsight.findFirst).toHaveBeenCalledWith({
      where: { id: 'insight-1', enterpriseId: 'enterprise-1' },
    });
    expect(skillVersions.createEnterpriseVersionFromContent).not.toHaveBeenCalled();
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    expect(prisma.capabilityInsight.update).not.toHaveBeenCalled();
  });

  it('does not expose or adopt another enterprise suggestion', async () => {
    prisma.capabilityInsight.findFirst.mockResolvedValue(null);
    await expect(service.adopt('admin-1', 'other-insight', { content: '新正文' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.capabilityInsight.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-insight', enterpriseId: ctx.enterpriseId },
    });
    expect(skillVersions.createEnterpriseVersionFromContent).not.toHaveBeenCalled();
  });

  it.each(['ADOPTED', 'DISMISSED'])('keeps historical %s suggestions immutable', async (status) => {
    prisma.capabilityInsight.findFirst.mockResolvedValue({ ...pending, status });
    await expect(service.adopt('admin-1', 'insight-1', { content: '新正文' }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.dismiss('admin-1', 'insight-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.capabilityInsight.update).not.toHaveBeenCalled();
    expect(skillVersions.createEnterpriseVersionFromContent).not.toHaveBeenCalled();
  });

  it.each(['adopt', 'dismiss', 'list', 'generate'])('keeps enterprise admin authorization for %s', async (action) => {
    enterpriseContext.assertEnterpriseAdmin.mockImplementation(() => {
      throw new ForbiddenException('仅企业管理员');
    });
    const request = action === 'adopt' ? service.adopt('member-1', 'insight-1', { content: '新正文' })
      : action === 'dismiss' ? service.dismiss('member-1', 'insight-1')
        : action === 'list' ? service.list('member-1', 'skill-1')
          : service.generate('member-1', 'skill-1', { scope: 'ALL' });
    await expect(request).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.capabilityInsight.findFirst).not.toHaveBeenCalled();
    expect(prisma.capabilityInsight.findMany).not.toHaveBeenCalled();
    expect(prisma.capability.findUnique).not.toHaveBeenCalled();
  });

  it('retains pending suggestion rejection without writing skill content', async () => {
    prisma.capabilityInsight.update.mockResolvedValue({ ...pending, status: 'DISMISSED' });
    await expect(service.dismiss('admin-1', 'insight-1')).resolves.toMatchObject({ status: 'DISMISSED' });
    expect(prisma.capabilityInsight.update).toHaveBeenCalledWith({
      where: { id: 'insight-1' },
      data: { status: 'DISMISSED', adoptedById: 'admin-1', resolvedAt: expect.any(Date) },
    });
    expect(skillVersions.createEnterpriseVersionFromContent).not.toHaveBeenCalled();
  });

  it('keeps historical adopted suggestions and version attribution readable within the enterprise', async () => {
    const history = [{ ...pending, status: 'ADOPTED', adoptedVersionId: 'enterprise-v1' }];
    prisma.capabilityInsight.findMany.mockResolvedValue(history);
    await expect(service.list('admin-1', 'skill-1')).resolves.toEqual(history);
    expect(prisma.capabilityInsight.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { capabilityId: 'skill-1', enterpriseId: 'enterprise-1' },
      include: { createdBy: { select: { id: true, name: true } }, adoptedBy: { select: { id: true, name: true } } },
    }));
  });

  it('still analyzes usage and stores suggestions without creating an enterprise skill version', async () => {
    prisma.capability.findUnique.mockResolvedValue({ id: 'skill-1', name: '分析助手', type: 'SKILL' });
    prisma.subscription.findFirst.mockResolvedValue({ id: 'subscription-1' });
    skillVersions.resolveEffectiveVersion.mockResolvedValue({ content: '当前正文' });
    prisma.toolExecution.findMany.mockResolvedValue([{
      input: { task: '分析' }, output: { result: '缺少指标' }, status: 'SUCCESS', user: { name: '成员一' },
    }]);
    prisma.skillVersion.findMany.mockResolvedValue([]);
    config.get.mockReturnValue('planner-test');
    const findings = [{ phenomenon: '结果缺少指标', suggestion: '添加指标定义', confidence: 0.8 }];
    const askModel = jest.spyOn(service as any, 'askModel').mockResolvedValue({ findings });
    prisma.capabilityInsight.create.mockResolvedValue({ ...pending, findings });

    await expect(service.generate('admin-1', 'skill-1', { scope: 'ALL' })).resolves.toMatchObject({ findings });
    expect(askModel).toHaveBeenCalledWith(expect.objectContaining({ baselineContent: '当前正文', modelId: 'planner-test' }));
    expect(prisma.capabilityInsight.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ capabilityId: 'skill-1', enterpriseId: 'enterprise-1',
        findings, scope: 'ALL', sampleSize: 1, personalCount: 0, createdById: 'admin-1' }),
    });
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    expect(skillVersions.createEnterpriseVersionFromContent).not.toHaveBeenCalled();
  });
});

import { createHash } from 'node:crypto';
import { backfillLegacyPlatformTemplates, LegacyTemplateReviewSchema } from './legacy-platform-template-backfill';

const template = '# 订单分析\n按用户提供的数据汇总，不执行账户操作。';
const sha256 = createHash('sha256').update(template).digest('hex');
const review = { capabilityId: 'legacy-skill', sourceSha256: sha256,
  reviewSummary: '审阅为咨询技能', executionBoundary: '仅分析授权数据；不得声称执行了退款。' };
function setup() {
  const capability = { id: 'legacy-skill', name: '中文技能', type: 'SKILL', status: 'APPROVED',
    enterpriseId: null, skillConfig: { template }, skillVersions: [] as any[] };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' }) },
    capability: { findUnique: jest.fn().mockResolvedValue(capability) } };
  const draft = { id: 'draft', updatedAt: new Date('2026-10-14T03:00:00Z') };
  const versions = { createPlatformVersion: jest.fn().mockResolvedValue(draft),
    publishPlatformVersion: jest.fn().mockImplementation(async (_admin, id, dto) => ({
      id, version: '1.0.0', content: versions.createPlatformVersion.mock.calls[0]?.[2].content ?? capability.skillVersions[0].content,
      status: 'PLATFORM_APPROVED', updatedAt: dto.expectedUpdatedAt,
    })) };
  return { prisma, versions, capability, draft };
}

describe('Reviewed legacy platform template backfill', () => {
  it('defaults to a read-only preflight preserving Chinese names and original templates', async () => {
    const { prisma, versions, capability } = setup();
    const result = await backfillLegacyPlatformTemplates(prisma as never, versions as never, [review]);
    expect(result[0]).toMatchObject({ name: '中文技能', status: 'READY', sourceSha256: sha256 });
    expect(versions.createPlatformVersion).not.toHaveBeenCalled();
    expect(capability.skillConfig.template).toBe(template);
  });

  it('uses normal create and preview-guarded publish rather than approved-row insertion', async () => {
    const { prisma, versions, draft } = setup();
    const result = await backfillLegacyPlatformTemplates(prisma as never, versions as never, [review], { apply: true, reviewerId: 'admin' });
    expect(versions.createPlatformVersion).toHaveBeenCalledWith('admin', 'legacy-skill', expect.objectContaining({
      content: expect.stringContaining(template), changeSummary: expect.stringContaining(sha256),
    }), { expectedTemplateSha256: sha256 });
    expect(versions.publishPlatformVersion).toHaveBeenCalledWith('admin', draft.id, expect.objectContaining({
      expectedUpdatedAt: draft.updatedAt.toISOString(), expectedPlatformVersionId: null,
    }));
    expect(result[0].status).toBe('PUBLISHED');
  });

  it('publishes reviewed replacement content without changing the original source hash guard', async () => {
    const { prisma, versions, capability } = setup();
    const reviewedContent = '# 售后草稿\n仅根据已核实的订单状态生成待审核话术。';
    await backfillLegacyPlatformTemplates(prisma as never, versions as never,
      [{ ...review, reviewedContent }], { apply: true, reviewerId: 'admin' });
    const dto = versions.createPlatformVersion.mock.calls[0][2];
    expect(dto.content).toContain(reviewedContent);
    expect(dto.content).not.toContain(template);
    expect(dto.changeSummary).toContain(sha256);
    expect(versions.createPlatformVersion.mock.calls[0][3]).toEqual({ expectedTemplateSha256: sha256 });
    expect(capability.skillConfig.template).toBe(template);
  });

  it('refuses changed templates and validates every item before writing', async () => {
    const { prisma, versions } = setup();
    await expect(backfillLegacyPlatformTemplates(prisma as never, versions as never,
      [review, { ...review, capabilityId: 'changed', sourceSha256: 'a'.repeat(64) }], { apply: true, reviewerId: 'admin' }))
      .rejects.toThrow('模板已变化');
    expect(versions.createPlatformVersion).not.toHaveBeenCalled();
  });

  it('requires an active admin for apply while allowing compatible local references in preflight', async () => {
    const { prisma, versions } = setup();
    prisma.user.findUnique.mockResolvedValue({ role: 'USER', status: 'ACTIVE' });
    await expect(backfillLegacyPlatformTemplates(prisma as never, versions as never, [review], { apply: true, reviewerId: 'user' }))
      .rejects.toThrow('平台管理员');
    await expect(backfillLegacyPlatformTemplates(prisma as never, versions as never,
      [{ ...review, executionBoundary: '读取 scripts/missing.py' }])).resolves.toMatchObject([{ status: 'READY' }]);
    expect(LegacyTemplateReviewSchema.safeParse([review, review]).success).toBe(false);
  });

  it('skips existing approved versions without republishing or changing content', async () => {
    const { prisma, versions, capability } = setup();
    capability.skillVersions.push({ id: 'approved', scope: 'PLATFORM', status: 'PLATFORM_APPROVED' });
    expect((await backfillLegacyPlatformTemplates(prisma as never, versions as never, [review], { apply: true, reviewerId: 'admin' }))[0])
      .toMatchObject({ status: 'ALREADY_APPROVED', versionId: 'approved' });
    expect(versions.publishPlatformVersion).not.toHaveBeenCalled();
  });

  it('resumes only the identical pending snapshot after interrupted publishing', async () => {
    const { prisma, versions, capability, draft } = setup();
    const content = `# 执行边界（优先于下方历史示例）\n\n${review.executionBoundary}\n\n${template}`;
    capability.skillVersions.push({ ...draft, scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW', content,
      changeSummary: `legacy-template-reviewed-v1; source-sha256=${sha256}; ${review.reviewSummary}` });
    await backfillLegacyPlatformTemplates(prisma as never, versions as never, [review], { apply: true, reviewerId: 'admin' });
    expect(versions.createPlatformVersion).not.toHaveBeenCalled();
    expect(versions.publishPlatformVersion).toHaveBeenCalledWith('admin', draft.id, expect.anything());
    capability.skillVersions[0].content = 'modified';
    await expect(backfillLegacyPlatformTemplates(prisma as never, versions as never, [review])).rejects.toThrow('人工选择来源');
  });

  it('does not hide a publication failure or publish later entries after a partial batch', async () => {
    const { prisma, versions, capability } = setup();
    prisma.capability.findUnique.mockImplementation(async ({ where }) => ({ ...capability, id: where.id }));
    versions.publishPlatformVersion.mockResolvedValueOnce({ id: 'published-first', version: '1.0.0', content: template })
      .mockRejectedValueOnce(new Error('publication failed'));
    const reviews = [review, { ...review, capabilityId: 'second' }, { ...review, capabilityId: 'third' }];
    await expect(backfillLegacyPlatformTemplates(prisma as never, versions as never, reviews, { apply: true, reviewerId: 'admin' }))
      .rejects.toThrow('publication failed');
    expect(versions.createPlatformVersion).toHaveBeenCalledTimes(2);
    expect(versions.publishPlatformVersion).toHaveBeenCalledTimes(2);
  });
});

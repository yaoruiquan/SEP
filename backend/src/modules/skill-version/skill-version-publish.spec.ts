import { BadRequestException, ConflictException } from '@nestjs/common';
import { PublishPlatformSkillVersionDtoSchema } from 'shared';
import { SkillVersionService } from './skill-version.service';
import { CapabilityValidatorService } from '../capability-contribution/capability-validator.service';
import { AdminSkillVersionController } from './skill-version.controller';

const time = new Date('2026-10-09T01:00:00.000Z');
const content = '# Client skill\nUse authorized business data and report the resulting analysis.';
const sourceCapability = {
  id: 'source-cap', name: 'Skill', description: 'Description', type: 'SKILL', enterpriseId: 'enterprise',
  visibility: 'ENTERPRISE_PRIVATE', contributorId: 'author', industry: [], position: [], inputSchema: {}, outputSchema: {},
  skillConfig: { modelId: 'model', temperature: 0.4, maxTokens: 1200 },
};
const base = {
  id: 'source', capabilityId: sourceCapability.id, scope: 'ENTERPRISE', status: 'ENTERPRISE_REJECTED',
  enterpriseId: 'enterprise', ownerId: null, createdById: 'author', version: '1.0.0', content, changeSummary: null,
  parentVersionId: null, sourceVersionId: null, workingCopyId: null, workingCopyUpdatedAt: null,
  submittedAt: time, enterpriseReviewedById: 'reviewer', enterpriseReviewedAt: time, rejectionReason: 'rejected',
  packageKey: null, packageSha256: null, packageFilename: null, packageFileCount: null,
  createdAt: time, updatedAt: time, platformReviewedAt: null,
};
const dto = { expectedUpdatedAt: time.toISOString(), expectedPlatformVersionId: null };

function setup(overrides: Record<string, unknown> = {}, publicSource = false) {
  let rows = [{ ...base, ...overrides }];
  const capabilities = new Map([
    [sourceCapability.id, { ...sourceCapability, ...(publicSource ? { enterpriseId: null, visibility: 'MARKET_PUBLIC' } : {}) }],
    ['platform-cap', { ...sourceCapability, id: 'platform-cap', enterpriseId: null, visibility: 'ENTERPRISE_PRIVATE' }],
  ]);
  const enrich = (row: typeof rows[number] | undefined) => row ? {
    ...row, capability: capabilities.get(row.capabilityId)!, enterprise: { id: 'enterprise', name: 'Enterprise' },
    sourceVersion: row.sourceVersionId ? { capability: capabilities.get(rows.find((r) => r.id === row.sourceVersionId)?.capabilityId ?? '') } : null,
  } : null;
  const prisma = {
    skillVersion: {
      findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(enrich(rows.find((row) =>
        where.sourceVersionId ? row.sourceVersionId === where.sourceVersionId : row.id === where.id)))),
      findUniqueOrThrow: jest.fn().mockImplementation(({ where }) => Promise.resolve(enrich(rows.find((row) => row.id === where.id)))),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        let matches = rows.filter((row) => (!where.id || row.id === where.id) && (!where.scope || row.scope === where.scope)
          && (!where.status || row.status === where.status) && (!where.workingCopyId || row.workingCopyId === where.workingCopyId)
          && (!where.workingCopyUpdatedAt || row.workingCopyUpdatedAt?.getTime() === where.workingCopyUpdatedAt.getTime()));
        if (where.capabilityId) matches = matches.filter((row) => typeof where.capabilityId === 'string'
          ? row.capabilityId === where.capabilityId : row.capabilityId !== where.capabilityId.not);
        if (where.sourceVersion) matches = matches.filter((row) => rows.find((r) => r.id === row.sourceVersionId)?.capabilityId === where.sourceVersion.capabilityId);
        if (where.promotedVersions) matches = matches.filter((row) => rows.some((r) => r.sourceVersionId === row.id));
        matches.sort((a, b) => (b.platformReviewedAt?.getTime() ?? 0) - (a.platformReviewedAt?.getTime() ?? 0));
        return Promise.resolve(enrich(matches[0]));
      }),
      findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(rows.filter((row) => row.capabilityId === where.capabilityId
        && row.scope === where.scope && (!where.id?.not || row.id !== where.id.not)))),
      create: jest.fn().mockImplementation(({ data }) => {
        const row = { ...base, ...data, id: `new-${rows.length}`, createdAt: new Date(), updatedAt: time };
        rows.push(row);
        return Promise.resolve(enrich(row));
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(enrich(row));
      }),
    },
    capability: { create: jest.fn().mockResolvedValue({ id: 'platform-cap' }), update: jest.fn() },
    skillConfig: { upsert: jest.fn() }, skillVersionReview: { create: jest.fn() },
    employeeCapabilityBinding: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    enterpriseSkillDefault: { updateMany: jest.fn() }, subscriptionSkillVersion: { updateMany: jest.fn() },
    contributionRewardEvent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: jest.fn(), $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn) => {
    const before = rows.map((row) => ({ ...row }));
    try { return await fn(prisma); } catch (error) { rows = before; throw error; }
  });
  const security = { assertReviewable: jest.fn() };
  const wallet = { creditContributionRewardInTx: jest.fn() };
  const service = new SkillVersionService(prisma as never, {} as never, {} as never, {} as never,
    new CapabilityValidatorService(), security as never, {} as never, wallet as never);
  return { prisma, service, security, wallet, rows: () => rows, add: (row: typeof base) => rows.push(row) };
}

describe('One-step platform publication', () => {
  it('requires both preview guards and rejects body overrides', () => {
    expect(PublishPlatformSkillVersionDtoSchema.safeParse(dto).success).toBe(true);
    expect(PublishPlatformSkillVersionDtoSchema.safeParse({ expectedUpdatedAt: dto.expectedUpdatedAt }).success).toBe(false);
    expect(PublishPlatformSkillVersionDtoSchema.safeParse({ ...dto, content }).success).toBe(false);
  });

  it('routes the validated publish request to the service', () => {
    const service = { publishPlatformVersion: jest.fn() };
    new AdminSkillVersionController(service as never).publish({ user: { id: 'admin', role: 'ADMIN' } }, 'source', dto);
    expect(service.publishPlatformVersion).toHaveBeenCalledWith('admin', 'source', dto);
  });

  it.each(['PERSONAL', 'ENTERPRISE'])('publishes a %s source atomically without enterprise approval or defaults changes', async (scope) => {
    const { service, prisma, rows, wallet } = setup({ scope });
    const result = await service.publishPlatformVersion('admin', 'source', dto);
    expect(result).toMatchObject({ scope: 'PLATFORM', status: 'PLATFORM_APPROVED', capabilityId: 'platform-cap',
      sourceVersionId: 'source', parentVersionId: null, version: '1.0.0', content });
    expect(rows()[0]).toMatchObject({ ...base, scope });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.capability.create.mock.calls[0][0].data).not.toHaveProperty('metadata');
    expect(prisma.capability.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'platform-cap' },
      data: expect.objectContaining({ visibility: 'MARKET_PUBLIC', status: 'APPROVED' }) }));
    expect(prisma.skillVersionReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      decision: 'APPROVE', actorType: 'PLATFORM', reviewerId: 'admin' }) }));
    expect(prisma.skillConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { template: content } }));
    expect(prisma.enterpriseSkillDefault.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscriptionSkillVersion.updateMany).not.toHaveBeenCalled();
    expect(prisma.employeeCapabilityBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      defaultSkillVersion: { scope: 'PLATFORM' } }) }));
    expect(wallet.creditContributionRewardInTx).toHaveBeenCalledTimes(1);
  });

  it('freezes mutable working copies, preserving enterprise review information', async () => {
    const { service, rows } = setup({ scope: 'PERSONAL', status: 'PERSONAL_ACTIVE', submittedAt: null });
    const result = await service.publishPlatformVersion('admin', 'source', dto);
    const snapshot = rows().find((row) => row.id === result.sourceVersionId)!;
    expect(snapshot).toMatchObject({ workingCopyId: 'source', workingCopyUpdatedAt: time, content, status: 'PERSONAL_ACTIVE' });
    expect(rows()[0].status).toBe('PERSONAL_ACTIVE');
  });

  it('reuses the private mapping and assigns the platform parent and next version', async () => {
    const { service, prisma, add } = setup();
    add({ ...base, id: 'previous-source' });
    add({ ...base, id: 'head', capabilityId: 'platform-cap', scope: 'PLATFORM', status: 'PLATFORM_APPROVED',
      sourceVersionId: 'previous-source', version: '1.0.1', platformReviewedAt: time });
    const result = await service.publishPlatformVersion('admin', 'source', { ...dto, expectedPlatformVersionId: 'head' });
    expect(result).toMatchObject({ capabilityId: 'platform-cap', parentVersionId: 'head', version: '1.0.2' });
    expect(prisma.capability.create).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'PENDING_PLATFORM_REVIEW', 'PLATFORM_REJECTED'])('directly publishes historical %s without another review stage', async (status) => {
    const { service, prisma } = setup({ scope: 'PLATFORM', status }, true);
    const result = await service.publishPlatformVersion('admin', 'source', dto);
    expect(result).toMatchObject({ id: 'source', status: 'PLATFORM_APPROVED', version: '1.0.0' });
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    expect(prisma.skillVersionReview.create).toHaveBeenCalledTimes(1);
  });

  it('renumbers older pending records against the current published head and records publication time', async () => {
    const { service, add, prisma } = setup({ scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW' }, true);
    add({ ...base, id: 'head', scope: 'PLATFORM', status: 'PLATFORM_APPROVED', version: '1.0.1',
      createdAt: new Date(time.getTime() + 1000), platformReviewedAt: time });
    const result = await service.publishPlatformVersion('admin', 'source', { ...dto, expectedPlatformVersionId: 'head' });
    expect(result).toMatchObject({ id: 'source', parentVersionId: 'head', version: '1.0.2' });
    expect(result.platformReviewedAt!.getTime()).toBeGreaterThan(time.getTime());
    expect(prisma.skillVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'PLATFORM_APPROVED' }),
      orderBy: [{ platformReviewedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }] }));
  });

  it('retries the same source without duplicate rewards, versions or binding changes', async () => {
    const { service, prisma, wallet, add } = setup();
    const first = await service.publishPlatformVersion('admin', 'source', dto);
    add({ ...base, id: 'later-release', capabilityId: 'platform-cap', scope: 'PLATFORM', status: 'PLATFORM_APPROVED',
      version: '1.0.1', platformReviewedAt: new Date() });
    const second = await service.publishPlatformVersion('admin', 'source', dto);
    expect(second!.id).toBe(first!.id);
    expect(prisma.skillVersion.create).toHaveBeenCalledTimes(1);
    expect(prisma.employeeCapabilityBinding.updateMany).toHaveBeenCalledTimes(1);
    expect(wallet.creditContributionRewardInTx).toHaveBeenCalledTimes(1);
  });

  it('returns a published platform result on retry even though publishing changed its timestamp', async () => {
    const { service, prisma } = setup({ scope: 'PLATFORM', status: 'DRAFT' }, true);
    await service.publishPlatformVersion('admin', 'source', dto);
    await service.publishPlatformVersion('admin', 'source', dto);
    expect(prisma.skillVersion.update).toHaveBeenCalledTimes(1);
  });

  it('refuses archived platform records', async () => {
    const { service, prisma } = setup({ scope: 'PLATFORM', status: 'ARCHIVED' }, true);
    await expect(service.publishPlatformVersion('admin', 'source', dto)).rejects.toThrow(BadRequestException);
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });

  it('rejects stale source previews before creating a platform version', async () => {
    const { service, prisma } = setup();
    await expect(service.publishPlatformVersion('admin', 'source', { ...dto, expectedUpdatedAt: new Date(0).toISOString() })).rejects.toThrow(ConflictException);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
  });

  it('rolls back new records when the platform preview is stale', async () => {
    const { service, prisma, rows } = setup();
    await expect(service.publishPlatformVersion('admin', 'source', { ...dto, expectedPlatformVersionId: 'stale' })).rejects.toThrow(ConflictException);
    expect(rows()).toHaveLength(1);
    expect(prisma.capability.update).not.toHaveBeenCalled();
    expect(prisma.skillVersionReview.create).not.toHaveBeenCalled();
  });

  it('does not leave a platform version when security validation fails', async () => {
    const { service, security, rows, prisma } = setup({ packageKey: 'skill.zip', packageSha256: 'hash', packageFileCount: 1 });
    security.assertReviewable.mockRejectedValue(new BadRequestException('security violation'));
    await expect(service.publishPlatformVersion('admin', 'source', dto)).rejects.toThrow('security violation');
    expect(rows()).toHaveLength(1);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    expect(prisma.capability.update).not.toHaveBeenCalled();
  });

  it('revalidates historical pending content instead of trusting a stored passing validation result', async () => {
    const { service, prisma } = setup({ scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW', content: 'short',
      validatedAt: time, validationResult: { valid: true } }, true);
    await expect(service.publishPlatformVersion('admin', 'source', dto)).rejects.toThrow(BadRequestException);
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    expect(prisma.capability.update).not.toHaveBeenCalled();
  });

  it('rolls the version back if reward settlement fails at the end of publication', async () => {
    const { service, wallet, rows } = setup();
    wallet.creditContributionRewardInTx.mockRejectedValue(new BadRequestException('reward unavailable'));
    await expect(service.publishPlatformVersion('admin', 'source', dto)).rejects.toThrow('reward unavailable');
    expect(rows()).toEqual([base]);
  });

  it('keeps structure warnings nonblocking but rejects invalid content before publication', async () => {
    const valid = setup();
    await valid.service.publishPlatformVersion('admin', 'source', dto);
    expect(valid.prisma.skillVersion.update.mock.calls[0][0].data.validationResult).toMatchObject({
      valid: true, warnings: expect.arrayContaining([expect.objectContaining({ code: 'SECTION_ROLE' })]),
    });
    const invalid = setup({ content: 'short' });
    await expect(invalid.service.publishPlatformVersion('admin', 'source', dto)).rejects.toThrow(BadRequestException);
    expect(invalid.prisma.skillVersion.create).not.toHaveBeenCalled();
  });
});

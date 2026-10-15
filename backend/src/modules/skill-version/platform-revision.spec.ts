import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, SkillVersion } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CapabilityValidatorService } from '../capability-contribution/capability-validator.service';
import { SkillVersionService } from './skill-version.service';

const time = new Date('2026-10-15T01:00:00.000Z');
const originalContent = '---\r\nname: order-analysis\r\n---\r\n\r\n# Orders\r\nAnalyze authorized order data.\r\n';
const revisedContent = '# Orders\nAnalyze authorized order data and report only verified results.';
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
const request = {
  content: revisedContent, changeSummary: 'Reviewed maintenance revision',
  expectedPlatformVersionId: 'head', expectedContentSha256: digest(originalContent),
};
const base: SkillVersion = {
  id: 'head', capabilityId: 'platform-skill', scope: 'PLATFORM', enterpriseId: null,
  ownerId: null, parentVersionId: 'older', sourceVersionId: null,
  workingCopyId: null, workingCopyUpdatedAt: null, version: '1.2.3', content: originalContent,
  changeSummary: 'Original release', status: 'PLATFORM_APPROVED',
  packageKey: null, packageSha256: null, packageFileCount: null, packageFilename: null,
  createdById: 'author', submittedAt: time, enterpriseReviewedById: null, enterpriseReviewedAt: null,
  platformReviewedById: 'admin', platformReviewedAt: time, rejectionReason: null,
  validationResult: { valid: true }, validatedAt: time, createdAt: time, updatedAt: time,
};

function setup() {
  const rows: SkillVersion[] = [{ ...base }];
  const capability = { id: base.capabilityId, type: 'SKILL', enterpriseId: null as string | null,
    status: 'APPROVED', visibility: 'MARKET_PUBLIC', platformReviewStatus: 'APPROVED', contributorId: 'author' };
  const template = { template: originalContent };
  const project = (row: SkillVersion | undefined, select?: Record<string, boolean>) => row
    ? select ? Object.fromEntries(Object.entries(row).filter(([key]) => select[key])) : { ...row, capability, sourceVersion: null }
    : null;
  const matches = (row: SkillVersion, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => {
    const actual = row[key as keyof SkillVersion];
    return value !== null && typeof value === 'object' && 'not' in value
      ? actual !== value.not : actual === value;
  });
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' }) },
    capability: { findUnique: jest.fn().mockResolvedValue(capability), update: jest.fn() },
    skillVersion: {
      findUnique: jest.fn().mockImplementation(async ({ where, select }) => project(rows.find((row) => matches(row, where)), select)),
      findUniqueOrThrow: jest.fn().mockImplementation(async ({ where, select }) => project(rows.find((row) => matches(row, where)), select)),
      findFirst: jest.fn().mockImplementation(async ({ where, select, orderBy }) => {
        const candidates = rows.filter((row) => matches(row, where));
        candidates.sort((a, b) => {
          if (orderBy[0].platformReviewedAt) {
            const releaseDiff = (b.platformReviewedAt?.getTime() ?? -Infinity) - (a.platformReviewedAt?.getTime() ?? -Infinity);
            if (releaseDiff) return releaseDiff;
          }
          return b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
        });
        return project(candidates[0], select);
      }),
      findMany: jest.fn().mockImplementation(async ({ where, select }) => rows.filter((row) => matches(row, where)).map((row) => project(row, select))),
      create: jest.fn().mockImplementation(async ({ data, select }) => {
        const row: SkillVersion = { ...base, id: `revision-${rows.length}`, parentVersionId: null,
          sourceVersionId: null, platformReviewedById: null, platformReviewedAt: null,
          createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(row);
        return project(row, select);
      }),
      update: jest.fn().mockImplementation(async ({ where, data, select }) => {
        const row = rows.find((candidate) => matches(candidate, where))!;
        Object.assign(row, data, { updatedAt: new Date() });
        return project(row, select);
      }),
      updateMany: jest.fn(),
    },
    skillConfig: { upsert: jest.fn() },
    skillVersionReview: { create: jest.fn() },
    employeeCapabilityBinding: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    enterpriseSkillDefault: { updateMany: jest.fn() },
    subscriptionSkillVersion: { updateMany: jest.fn() },
    contributionRewardEvent: { createMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: base.capabilityId }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  const validator = new CapabilityValidatorService();
  const validate = jest.spyOn(validator, 'validateSkill');
  const security = { assertReviewable: jest.fn() };
  const wallet = { creditContributionRewardInTx: jest.fn() };
  const settings = { getEffectiveValue: jest.fn().mockResolvedValue('false') };
  const service = new SkillVersionService(prisma as never, {} as never, {} as never, {} as never,
    validator, security as never, undefined, wallet as never, settings as never);
  const noPublication = () => {
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    expect(prisma.skillVersion.updateMany).not.toHaveBeenCalled();
    expect(prisma.capability.update).not.toHaveBeenCalled();
    expect(prisma.skillConfig.upsert).not.toHaveBeenCalled();
    expect(prisma.skillVersionReview.create).not.toHaveBeenCalled();
    expect(prisma.employeeCapabilityBinding.updateMany).not.toHaveBeenCalled();
    expect(prisma.enterpriseSkillDefault.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscriptionSkillVersion.updateMany).not.toHaveBeenCalled();
    expect(prisma.contributionRewardEvent.createMany).not.toHaveBeenCalled();
    expect(wallet.creditContributionRewardInTx).not.toHaveBeenCalled();
    expect(settings.getEffectiveValue).not.toHaveBeenCalled();
    expect(rows[0]).toEqual(base);
    expect(template.template).toBe(originalContent);
  };
  return { prisma, rows, capability, service, validate, security, noPublication };
}

describe('Single-file platform maintenance revisions', () => {
  it('creates a validated pending child with the next platform semver, without modifying the original or publishing', async () => {
    const { service, prisma, rows, validate, noPublication } = setup();
    rows.push({ ...base, id: 'other-pending', status: 'PENDING_PLATFORM_REVIEW', version: '2.0.8' });
    rows.push({ ...base, id: 'personal', scope: 'PERSONAL', version: '99.0.0' });
    rows.push({ ...base, id: 'legacy', version: 'legacy', platformReviewedAt: new Date(time.getTime() - 1000) });
    const result = await service.createPlatformRevision('admin', base.capabilityId, request);
    expect(result).toMatchObject({ scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW', enterpriseId: null,
      capabilityId: base.capabilityId, parentVersionId: base.id, version: '2.0.9', content: revisedContent,
      changeSummary: request.changeSummary, submittedAt: expect.any(Date), updatedAt: expect.any(Date) });
    expect(result.id).not.toBe(base.id);
    expect(rows.at(-1)).toMatchObject({ createdById: 'admin', platformReviewedAt: null, platformReviewedById: null,
      packageKey: null, packageSha256: null, packageFileCount: null, packageFilename: null,
      validationResult: { valid: true, warnings: expect.any(Array) }, validatedAt: result.submittedAt });
    expect(validate).toHaveBeenCalledWith(revisedContent);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'admin' }, select: { role: true, status: true } });
    expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toBe('SELECT id FROM capabilities WHERE id = ? FOR UPDATE');
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe(base.capabilityId);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.capability.findUnique.mock.invocationCallOrder[0]);
    expect(prisma.capability.findUnique.mock.invocationCallOrder[0]).toBeLessThan(prisma.skillVersion.findFirst.mock.invocationCallOrder[0]);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
    noPublication();
  });

  it('returns the identical pending revision on retry without allocating another version or changing updatedAt', async () => {
    const { service, prisma, validate, noPublication } = setup();
    const first = await service.createPlatformRevision('admin', base.capabilityId, request);
    const retried = await service.createPlatformRevision('admin', base.capabilityId, request);
    expect(retried).toEqual(first);
    expect(prisma.skillVersion.create).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(2);
    noPublication();
  });

  it.each([
    { expectedPlatformVersionId: 'stale-head' },
    { expectedContentSha256: '0'.repeat(64) },
    { expectedContentSha256: digest(originalContent.replace(/\r\n/g, '\n')) },
  ])('rejects a stale id or exact-byte content SHA: %j', async (guard) => {
    const { service, prisma, validate, noPublication } = setup();
    await expect(service.createPlatformRevision('admin', base.capabilityId, { ...request, ...guard })).rejects.toThrow(ConflictException);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    noPublication();
  });

  it('checks the current release before returning any existing matching pending revision', async () => {
    const { service, prisma, rows, noPublication } = setup();
    await service.createPlatformRevision('admin', base.capabilityId, request);
    rows.push({ ...base, id: 'new-head', version: '1.2.5', platformReviewedAt: new Date(time.getTime() + 1000) });
    await expect(service.createPlatformRevision('admin', base.capabilityId, request)).rejects.toThrow(ConflictException);
    const result = await service.createPlatformRevision('admin', base.capabilityId, { ...request, expectedPlatformVersionId: 'new-head' });
    expect(result).toMatchObject({ parentVersionId: 'new-head', version: '1.2.6' });
    expect(prisma.skillVersion.create).toHaveBeenCalledTimes(2);
    noPublication();
  });

  it('never treats an approved version as the idempotent pending result', async () => {
    const { service, rows, noPublication } = setup();
    const result = await service.createPlatformRevision('admin', base.capabilityId,
      { ...request, content: revisedContent, changeSummary: request.changeSummary });
    expect(result.id).not.toBe(base.id);
    expect(result.status).toBe('PENDING_PLATFORM_REVIEW');
    expect(rows).toHaveLength(2);
    noPublication();
  });

  it.each([
    { content: `${revisedContent}\nAdditional reviewed boundary.` },
    { changeSummary: 'Different review summary' },
  ])('does not reuse pending revisions with different content or summary: %j', async (changes) => {
    const { service, prisma, noPublication } = setup();
    const first = await service.createPlatformRevision('admin', base.capabilityId, request);
    const second = await service.createPlatformRevision('admin', base.capabilityId, { ...request, ...changes });
    expect(second.id).not.toBe(first.id);
    expect(prisma.skillVersion.create).toHaveBeenCalledTimes(2);
    noPublication();
  });

  it.each([null, { role: 'USER', status: 'ACTIVE' }, { role: 'CONTRIBUTOR', status: 'ACTIVE' },
    { role: 'ADMIN', status: 'DISABLED' }])('denies callers without active platform admin privileges: %j', async (actor) => {
    const { service, prisma, noPublication } = setup();
    prisma.user.findUnique.mockResolvedValue(actor);
    await expect(service.createPlatformRevision('caller', base.capabilityId, request)).rejects.toThrow(ForbiddenException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    noPublication();
  });

  it.each([{ type: 'AGENT' }, { enterpriseId: 'enterprise' }, { status: 'PENDING' }, { status: 'REJECTED' }])(
    'rejects capabilities outside the approved platform skill boundary: %j', async (changes) => {
      const { service, prisma, capability, noPublication } = setup();
      Object.assign(capability, changes);
      await expect(service.createPlatformRevision('admin', base.capabilityId, request)).rejects.toThrow(BadRequestException);
      expect(prisma.skillVersion.create).not.toHaveBeenCalled();
      noPublication();
    });

  it('rejects a missing capability', async () => {
    const { service, prisma, noPublication } = setup();
    prisma.capability.findUnique.mockResolvedValue(null);
    await expect(service.createPlatformRevision('admin', base.capabilityId, request)).rejects.toThrow(NotFoundException);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    noPublication();
  });

  it('requires an existing formally approved platform release', async () => {
    const { service, prisma, rows } = setup();
    rows[0].status = 'PENDING_PLATFORM_REVIEW';
    await expect(service.createPlatformRevision('admin', base.capabilityId, request)).rejects.toThrow(ConflictException);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });

  it.each([{ packageKey: 'skills/archive.zip' }, { packageSha256: 'a'.repeat(64) },
    { packageFileCount: 0 }, { packageFilename: '' }])('rejects even partial package metadata without discarding it: %j', async (metadata) => {
    const { service, prisma, rows, validate, security } = setup();
    Object.assign(rows[0], metadata);
    const before = { ...rows[0] };
    await expect(service.createPlatformRevision('admin', base.capabilityId, request)).rejects.toThrow('不能丢弃原技能包');
    expect(rows).toEqual([before]);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(security.assertReviewable).not.toHaveBeenCalled();
  });

  it.each(['   ', '---\nname: [\n---\n# Invalid frontmatter', '# Orders\nRun scripts/missing.py'])('rejects failed source validation without writing: %j', async (content) => {
    const { service, prisma, noPublication } = setup();
    await expect(service.createPlatformRevision('admin', base.capabilityId, { ...request, content })).rejects.toThrow(BadRequestException);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
    noPublication();
  });

  it('returns a summary and content usable by the existing preview-guarded publication method', async () => {
    const { service, prisma, rows } = setup();
    const revision = await service.createPlatformRevision('admin', base.capabilityId, request);
    const result = await service.publishPlatformVersion('admin', revision.id, {
      expectedUpdatedAt: revision.updatedAt.toISOString(), expectedPlatformVersionId: base.id,
    });
    expect(result).toMatchObject({ id: revision.id, status: 'PLATFORM_APPROVED', content: revisedContent, parentVersionId: base.id });
    expect(prisma.skillVersion.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: revision.id } }));
    expect(rows[0]).toEqual(base);
    expect(prisma.skillConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { template: revisedContent } }));
  });
});

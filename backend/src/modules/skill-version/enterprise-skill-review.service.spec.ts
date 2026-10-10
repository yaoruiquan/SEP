import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { CapabilityType, Prisma, SkillVersion } from '@prisma/client';
import { EnterpriseContextService, type EnterpriseContext } from '../enterprise/enterprise-context.service';
import { EnterpriseSkillReviewService, PERSONAL_REVIEW_RELATIONS, personalReviewState } from './enterprise-skill-review.service';

type Adoption = { targetVersionId: string; adoptedAt: Date };
type Reviewer = { id: string; name: string | null };
type Snapshot = {
  status: string; createdAt: Date; workingCopyUpdatedAt: Date | null; enterpriseReviewedAt: Date | null;
  rejectionReason: string | null; adoptedInto: Adoption[];
  enterpriseReviewedBy?: Reviewer | null;
};
type SourceOverrides = Partial<SkillVersion> & {
  owner?: { name: string | null } | null; adoptedInto?: Adoption[]; reviewSnapshots?: Snapshot[];
  enterpriseReviewedBy?: Reviewer | null;
  capability?: { type: CapabilityType };
};

describe('EnterpriseSkillReviewService', () => {
  const now = new Date('2026-10-09T08:00:00.000Z');
  const editedAt = new Date('2026-10-09T07:00:00.000Z');
  const ctx: EnterpriseContext = {
    enterpriseId: 'ent-1', memberId: 'admin-member', role: 'ENTERPRISE_ADMIN', departmentId: null,
  };

  function source(overrides: SourceOverrides = {}) {
    return {
      id: 'client-1', capabilityId: 'cap-1', enterpriseId: 'ent-1', ownerId: 'member-1',
      scope: 'PERSONAL' as const, status: 'PENDING_ENTERPRISE_REVIEW' as const,
      workingCopyId: null, workingCopyUpdatedAt: null, parentVersionId: 'platform-1', version: '0.0.0-personal.client',
      content: '---\r\nname: exact-source\r\n---\r\n\r\n# Instructions  \r\n', changeSummary: 'Improve instructions',
      createdById: 'member-1', submittedAt: editedAt, updatedAt: editedAt, createdAt: editedAt,
      enterpriseReviewedById: null, enterpriseReviewedBy: null as Reviewer | null, enterpriseReviewedAt: null, rejectionReason: null,
      packageKey: 'skills/package.zip', packageSha256: 'abc123', packageFilename: 'skill.zip', packageFileCount: 3,
      owner: { name: 'Member One' }, adoptedInto: [] as Adoption[], reviewSnapshots: [] as Snapshot[],
      capability: { type: 'SKILL' as CapabilityType },
      ...overrides,
    };
  }

  function build(rows = [source()], context: EnterpriseContext = ctx) {
    const events: string[] = [];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue(rows.map(({ id }) => ({ id }))),
      skillVersion: {
        findFirst: jest.fn().mockImplementation(async ({ where }) => rows.find((row) =>
          row.id === where.id && row.scope === where.scope && row.enterpriseId === where.enterpriseId &&
          row.workingCopyId === where.workingCopyId &&
          (!where.capability || row.capability.type === where.capability.type)) ?? null),
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          if (where.scope === 'ENTERPRISE') return [{ version: '1.0.4' }, { version: '1.0.0' }];
          return rows.filter((row) => where.id.in.includes(row.id) && row.capabilityId === where.capabilityId &&
            row.enterpriseId === where.enterpriseId && row.scope === where.scope &&
            row.workingCopyId === where.workingCopyId);
        }),
        create: jest.fn().mockImplementation(async ({ data }) => {
          events.push(`create:${data.scope}`);
          return { id: data.scope === 'ENTERPRISE' ? 'enterprise-new' : `snapshot-${data.workingCopyId}`, createdAt: now, ...data };
        }),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          events.push(`update:${where.id}`);
          return { ...rows.find(({ id }) => id === where.id), ...data };
        }),
      },
      skillVersionReview: { create: jest.fn().mockResolvedValue({ id: 'review-1' }) },
      skillVersionAdoption: { createMany: jest.fn().mockResolvedValue({ count: rows.length }) },
      memberSkillVersionSelection: { upsert: jest.fn(), updateMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => {
        events.push('transaction:start');
        try {
          const result = await callback(tx);
          events.push('transaction:commit');
          return result;
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        }
      }),
      enterpriseMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'member-1' }, { userId: 'member-2' }]) },
      notification: { createMany: jest.fn().mockImplementation(async () => {
        events.push('notify');
        return { count: 2 };
      }) },
    };
    const defaults = {
      lock: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({ versionId: 'enterprise-base', version: { id: 'enterprise-base', content: 'first\nsecond\nthird' } }),
      set: jest.fn().mockResolvedValue({ affectedSubscriptions: 2 }),
    };
    const enterpriseContext = {
      resolve: jest.fn().mockResolvedValue(context),
      assertEnterpriseAdmin: jest.fn((value: EnterpriseContext) =>
        EnterpriseContextService.prototype.assertEnterpriseAdmin(value)),
    };
    const service = new EnterpriseSkillReviewService(prisma as never, enterpriseContext as never, defaults as never);
    return { service, prisma, tx, defaults, enterpriseContext, events };
  }

  function expectNoWrites(tx: ReturnType<typeof build>['tx'], defaults: ReturnType<typeof build>['defaults']) {
    expect(tx.skillVersion.create).not.toHaveBeenCalled();
    expect(tx.skillVersion.update).not.toHaveBeenCalled();
    expect(tx.skillVersionReview.create).not.toHaveBeenCalled();
    expect(tx.skillVersionAdoption.createMany).not.toHaveBeenCalled();
    expect(defaults.set).not.toHaveBeenCalled();
  }

  it('rejects multi-source review before opening a transaction', async () => {
    const { service, prisma } = build();
    await expect(service.reviewMany('admin-1', ['client-1', 'client-2'], { decision: 'APPROVE' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a Web body override even for a single source', async () => {
    const { service, prisma } = build();
    await expect(service.reviewMany('admin-1', ['client-1'], { decision: 'APPROVE' }, {}, 'cap-1', 'edited body'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('client submissions', () => {
    it('approves the personal source, publishes an enterprise version, and sets its persistent default in one transaction', async () => {
      const row = source();
      const { service, prisma, tx, defaults, events } = build([row]);
      const result = await service.review('admin-1', row.id, { decision: 'APPROVE', comment: 'Reviewed' });

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
      expect(defaults.lock).toHaveBeenCalledWith(tx, 'ent-1', 'cap-1');
      expect(defaults.get).toHaveBeenCalledWith('ent-1', 'cap-1', tx);
      expect(tx.skillVersion.findFirst).toHaveBeenCalledWith({
        where: { id: row.id, scope: 'PERSONAL', enterpriseId: 'ent-1', workingCopyId: null, capability: { type: 'SKILL' } },
        select: { capabilityId: true },
      });
      expect(tx.skillVersion.update).toHaveBeenCalledWith({
        where: { id: row.id }, data: {
          status: 'ENTERPRISE_APPROVED', enterpriseReviewedById: 'admin-1', enterpriseReviewedAt: now, rejectionReason: null,
        },
      });
      expect(tx.skillVersion.create).toHaveBeenCalledTimes(1);
      expect(tx.skillVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        capabilityId: 'cap-1', enterpriseId: 'ent-1', scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED',
        parentVersionId: 'enterprise-base', version: '1.0.5', content: row.content,
        createdById: 'admin-1', enterpriseReviewedById: 'admin-1', enterpriseReviewedAt: now,
        packageKey: row.packageKey, packageSha256: row.packageSha256,
        packageFilename: row.packageFilename, packageFileCount: row.packageFileCount,
      }) });
      expect(tx.skillVersionReview.create).toHaveBeenCalledWith({ data: {
        versionId: row.id, actorType: 'ENTERPRISE', decision: 'APPROVE', reviewerId: 'admin-1', comment: 'Reviewed',
      } });
      expect(tx.skillVersionAdoption.createMany).toHaveBeenCalledWith({ data: [{
        sourceVersionId: row.id, targetVersionId: 'enterprise-new', adoptedById: 'admin-1', batchId: null,
      }] });
      expect(defaults.set).toHaveBeenCalledWith(tx, 'ent-1', 'cap-1', 'enterprise-new', 'admin-1');
      expect(result).toEqual(expect.objectContaining({
        id: row.id, ownerId: row.ownerId, scope: 'PERSONAL', status: 'ENTERPRISE_APPROVED',
        publishedVersionId: 'enterprise-new', affectedSubscriptions: 2,
      }));
      expect(tx.memberSkillVersionSelection.upsert).not.toHaveBeenCalled();
      expect(tx.memberSkillVersionSelection.updateMany).not.toHaveBeenCalled();
      expect(prisma.enterpriseMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ enterpriseId: 'ent-1' }), select: { userId: true },
      }));
      expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
        expect.objectContaining({ userId: 'member-1', type: 'SKILL_VERSION_UPDATED', relatedId: 'cap-1' }),
        expect.objectContaining({ userId: 'member-2', type: 'SKILL_VERSION_UPDATED', relatedId: 'cap-1' }),
      ]) });
      expect(events.indexOf('notify')).toBeGreaterThan(events.indexOf('transaction:commit'));
    });

    it('falls back to the source parent when no enterprise baseline exists', async () => {
      const { service, tx, defaults } = build();
      defaults.get.mockResolvedValue(null);
      await service.review('admin-1', 'client-1', { decision: 'APPROVE' });
      expect(tx.skillVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ parentVersionId: 'platform-1' }) });
    });

    it('rejects a submission with a reason without publishing or changing the default', async () => {
      const { service, prisma, tx, defaults } = build();
      const result = await service.review('admin-1', 'client-1', { decision: 'REJECT', comment: 'Unsafe instructions' });
      expect(tx.skillVersion.update).toHaveBeenCalledWith({ where: { id: 'client-1' }, data: {
        status: 'ENTERPRISE_REJECTED', enterpriseReviewedById: 'admin-1', enterpriseReviewedAt: now,
        rejectionReason: 'Unsafe instructions',
      } });
      expect(tx.skillVersionReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        versionId: 'client-1', decision: 'REJECT', comment: 'Unsafe instructions',
      }) });
      expect(tx.skillVersion.create).not.toHaveBeenCalled();
      expect(tx.skillVersionAdoption.createMany).not.toHaveBeenCalled();
      expect(defaults.set).not.toHaveBeenCalled();
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        status: 'ENTERPRISE_REJECTED', rejectionReason: 'Unsafe instructions',
        publishedVersionId: null, affectedSubscriptions: 0,
      }));
    });

    it.each([undefined, '', '  '])('requires a nonblank rejection reason (%j)', async (comment) => {
      const { service, prisma } = build();
      await expect(service.review('admin-1', 'client-1', { decision: 'REJECT', comment }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('Web working copies', () => {
    it.each(['APPROVE', 'REJECT'] as const)('creates an immutable %s snapshot without changing the editable working copy', async (decision) => {
      const row = source({ id: 'web-1', status: 'PERSONAL_ACTIVE', submittedAt: null });
      const original = { ...row };
      const { service, tx, defaults, prisma } = build([row]);
      const result = await service.review('admin-1', row.id, {
        decision, comment: 'Checked content', expectedUpdatedAt: editedAt.toISOString(),
      });
      const status = decision === 'APPROVE' ? 'ENTERPRISE_APPROVED' : 'ENTERPRISE_REJECTED';
      expect(tx.skillVersion.update).not.toHaveBeenCalled();
      expect(tx.skillVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        scope: 'PERSONAL', workingCopyId: row.id, workingCopyUpdatedAt: row.updatedAt, ownerId: row.ownerId,
        parentVersionId: row.parentVersionId, version: row.version, content: row.content,
        changeSummary: row.changeSummary, createdById: row.createdById,
        packageKey: row.packageKey, packageSha256: row.packageSha256,
        packageFileCount: row.packageFileCount, packageFilename: row.packageFilename,
        submittedAt: now, status, enterpriseReviewedById: 'admin-1', enterpriseReviewedAt: now,
        rejectionReason: decision === 'REJECT' ? 'Checked content' : null,
      }) });
      expect(tx.skillVersionReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        versionId: 'snapshot-web-1', decision,
      }) });
      expect(row).toEqual(original);
      expect(result).toEqual(expect.objectContaining({ id: row.id, status }));
      if (decision === 'APPROVE') {
        expect(tx.skillVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
          capabilityId: row.capabilityId, enterpriseId: row.enterpriseId,
          scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED', content: row.content,
        }) });
        expect(tx.skillVersionAdoption.createMany).toHaveBeenCalledWith({ data: [{
          sourceVersionId: 'snapshot-web-1', targetVersionId: 'enterprise-new', adoptedById: 'admin-1', batchId: null,
        }] });
        expect(defaults.set).toHaveBeenCalledTimes(1);
        expect(defaults.set).toHaveBeenCalledWith(tx, 'ent-1', 'cap-1', 'enterprise-new', 'admin-1');
        expect(result).toEqual(expect.objectContaining({ publishedVersionId: 'enterprise-new', affectedSubscriptions: 2 }));
      } else {
        expect(tx.skillVersion.create).toHaveBeenCalledTimes(1);
        expect(tx.skillVersionAdoption.createMany).not.toHaveBeenCalled();
        expect(defaults.set).not.toHaveBeenCalled();
        expect(prisma.notification.createMany).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ publishedVersionId: null, affectedSubscriptions: 0 }));
      }
    });

    it.each([undefined, '2026-10-09T06:59:59.999Z', 'not-a-date'])('rejects a missing or stale preview timestamp (%j) before writes', async (expectedUpdatedAt) => {
      const { service, tx, defaults, prisma } = build([source({ id: 'web-1', status: 'PERSONAL_ACTIVE' })]);
      await expect(service.review('admin-1', 'web-1', { decision: 'APPROVE', expectedUpdatedAt }))
        .rejects.toBeInstanceOf(ConflictException);
      expectNoWrites(tx, defaults);
      expect(defaults.get).not.toHaveBeenCalled();
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('checks updatedAt after acquiring the row lock to catch a save concurrent with preview', async () => {
      const row = source({ id: 'web-1', status: 'PERSONAL_ACTIVE' });
      const { service, tx, defaults } = build([row]);
      tx.$queryRaw.mockImplementationOnce(async () => {
        row.updatedAt = new Date('2026-10-09T07:30:00.000Z');
        row.content = 'Edited after preview';
        return [{ id: row.id }];
      });
      await expect(service.review('admin-1', row.id, { decision: 'APPROVE', expectedUpdatedAt: editedAt.toISOString() }))
        .rejects.toBeInstanceOf(ConflictException);
      expectNoWrites(tx, defaults);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.skillVersion.findMany.mock.invocationCallOrder[0]);
    });

    it('accepts a timezone-equivalent preview timestamp', async () => {
      const { service } = build([source({ id: 'web-1', status: 'PERSONAL_ACTIVE' })]);
      await expect(service.review('admin-1', 'web-1', {
        decision: 'APPROVE', expectedUpdatedAt: '2026-10-09T15:00:00.000+08:00',
      })).resolves.toEqual(expect.objectContaining({ publishedVersionId: 'enterprise-new' }));
    });
  });

  describe('permissions and repeated review', () => {
    it.each(['MEMBER', 'DEPT_MANAGER'] as const)('denies %s before entering a transaction', async (role) => {
      const { service, prisma } = build([source()], { ...ctx, role });
      await expect(service.review('user-1', 'client-1', { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propagates a missing enterprise membership without entering a transaction', async () => {
      const { service, prisma, enterpriseContext } = build();
      enterpriseContext.resolve.mockRejectedValue(new ForbiddenException('No membership'));
      await expect(service.review('user-1', 'client-1', { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      { enterpriseId: 'other-enterprise' }, { scope: 'ENTERPRISE' as const }, { workingCopyId: 'web-1' },
      { capability: { type: 'RPA' as const } },
    ])('conceals a cross-enterprise, nonpersonal, snapshot, or nonskill source (%j)', async (overrides) => {
      const { service, tx, defaults } = build([source(overrides)]);
      await expect(service.review('admin-1', 'client-1', { decision: 'APPROVE' })).rejects.toBeInstanceOf(NotFoundException);
      expectNoWrites(tx, defaults);
      expect(defaults.lock).not.toHaveBeenCalled();
    });

    it('enforces the capability supplied by the caller', async () => {
      const { service, tx, defaults } = build();
      await expect(service.reviewMany('admin-1', ['client-1'], { decision: 'APPROVE' }, {}, 'cap-2'))
        .rejects.toBeInstanceOf(NotFoundException);
      expectNoWrites(tx, defaults);
      expect(defaults.lock).not.toHaveBeenCalled();
    });

    it.each([
      source({ status: 'ENTERPRISE_REJECTED' }),
      source({ status: 'ENTERPRISE_APPROVED', adoptedInto: [{ targetVersionId: 'already-published', adoptedAt: now }] }),
      source({ id: 'web-1', status: 'PERSONAL_ACTIVE', reviewSnapshots: [{
        status: 'ENTERPRISE_REJECTED', createdAt: now, workingCopyUpdatedAt: editedAt,
        enterpriseReviewedAt: now, rejectionReason: 'Rejected', adoptedInto: [],
      }] }),
      source({ id: 'web-1', status: 'PERSONAL_ACTIVE', reviewSnapshots: [{
        status: 'ENTERPRISE_APPROVED', createdAt: now, workingCopyUpdatedAt: editedAt,
        enterpriseReviewedAt: now, rejectionReason: null,
        adoptedInto: [{ targetVersionId: 'already-published', adoptedAt: now }],
      }] }),
    ])('returns HTTP 409 for an already processed revision (%j)', async (row) => {
      const { service, tx, defaults } = build([row]);
      const review = service.review('admin-1', row.id, { decision: 'APPROVE', expectedUpdatedAt: editedAt.toISOString() });
      await expect(review).rejects.toBeInstanceOf(ConflictException);
      await expect(review).rejects.toMatchObject({ status: 409 });
      expectNoWrites(tx, defaults);
    });

    it.each<{ ids: string[] }>([{ ids: [] }, { ids: ['client-1', 'client-1'] }])('rejects empty or duplicate ids (%j)', async ({ ids }) => {
      const { service, prisma } = build();
      await expect(service.reviewMany('admin-1', ids, { decision: 'APPROVE' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('legacy publications', () => {
    it('publishes an approved but unpublished personal version only after explicit approval', async () => {
      const row = source({ status: 'ENTERPRISE_APPROVED', enterpriseReviewedAt: editedAt });
      const { service, tx, defaults } = build([row]);
      const result = await service.review('admin-1', row.id, { decision: 'APPROVE' });
      expect(result.publishedVersionId).toBe('enterprise-new');
      expect(defaults.set).toHaveBeenCalledWith(tx, 'ent-1', 'cap-1', 'enterprise-new', 'admin-1');
      expect(tx.skillVersionReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        versionId: row.id, decision: 'APPROVE', comment: '历史已通过个人版本发布为企业版',
      }) });
    });

    it('does not allow rejection of a legacy approved version', async () => {
      const { service, tx, defaults } = build([source({ status: 'ENTERPRISE_APPROVED' })]);
      await expect(service.review('admin-1', 'client-1', { decision: 'REJECT', comment: 'Reject legacy' }))
        .rejects.toBeInstanceOf(ConflictException);
      expectNoWrites(tx, defaults);
    });
  });

  describe('batch transactions', () => {

    it('does not support batch rejection', async () => {
      const { service, prisma } = build([source({ id: 'a' }), source({ id: 'b' })]);
      await expect(service.reviewMany('admin-1', ['a', 'b'], { decision: 'REJECT', comment: 'Reject all' }, {}, 'cap-1', source().content))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propagates a default failure to the transaction and does not send publication notifications', async () => {
      const { service, defaults, prisma, events } = build();
      const failure = new Error('default unavailable');
      defaults.set.mockRejectedValue(failure);
      await expect(service.review('admin-1', 'client-1', { decision: 'APPROVE' })).rejects.toBe(failure);
      expect(events).toContain('transaction:rollback');
      expect(events).not.toContain('transaction:commit');
      expect(prisma.enterpriseMember.findMany).not.toHaveBeenCalled();
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('propagates an audit write failure without publishing or changing defaults', async () => {
      const { service, tx, defaults, prisma } = build();
      const failure = new Error('audit unavailable');
      tx.skillVersionReview.create.mockRejectedValue(failure);
      await expect(service.review('admin-1', 'client-1', { decision: 'APPROVE' })).rejects.toBe(failure);
      expect(tx.skillVersion.create).not.toHaveBeenCalled();
      expect(tx.skillVersionAdoption.createMany).not.toHaveBeenCalled();
      expect(defaults.set).not.toHaveBeenCalled();
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('keeps a successful publication result when post-commit notification delivery fails', async () => {
      const { service, prisma, events } = build();
      const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      prisma.notification.createMany.mockRejectedValue(new Error('notification unavailable'));
      await expect(service.review('admin-1', 'client-1', { decision: 'APPROVE' }))
        .resolves.toEqual(expect.objectContaining({ publishedVersionId: 'enterprise-new', affectedSubscriptions: 2 }));
      expect(events).toContain('transaction:commit');
      expect(events).not.toContain('transaction:rollback');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('notification unavailable'));
    });
  });

  describe('personalReviewState', () => {
    it('does not treat an operations source snapshot as enterprise approval', () => {
      const row = source({ status: 'PERSONAL_ACTIVE', reviewSnapshots: [{
        status: 'PERSONAL_ACTIVE', createdAt: now, workingCopyUpdatedAt: editedAt,
        enterpriseReviewedAt: null, rejectionReason: null, adoptedInto: [],
      }] });
      expect(personalReviewState(row)).toMatchObject({ pending: true, reviewStatus: 'PENDING_ENTERPRISE_REVIEW',
        publishedVersionId: null, reviewedBy: null });
    });

    it('selects reviewer identity on both roots and snapshots along with the source revision', () => {
      expect(PERSONAL_REVIEW_RELATIONS.enterpriseReviewedBy).toEqual({ select: { id: true, name: true } });
      expect(PERSONAL_REVIEW_RELATIONS.reviewSnapshots.select).toEqual(expect.objectContaining({
        workingCopyUpdatedAt: true,
        enterpriseReviewedBy: { select: { id: true, name: true } },
      }));
    });

    it.each(['ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'] as const)('returns the root reviewer for a %s client version', (status) => {
      const reviewer = { id: 'admin-1', name: 'Enterprise Admin' };
      const approved = status === 'ENTERPRISE_APPROVED';
      const row = source({
        status, enterpriseReviewedById: reviewer.id, enterpriseReviewedBy: reviewer,
        enterpriseReviewedAt: now, rejectionReason: approved ? null : 'Unsafe instructions',
        adoptedInto: approved ? [{ targetVersionId: 'enterprise-reviewed', adoptedAt: now }] : [],
      });
      expect(personalReviewState(row)).toEqual({
        reviewStatus: status, publishedVersionId: approved ? 'enterprise-reviewed' : null,
        isWorkingCopy: false, isLegacyUnpublished: false, pending: false,
        enterpriseReviewedAt: now, rejectionReason: approved ? null : 'Unsafe instructions', reviewedBy: reviewer,
      });
    });

    it('preserves a null reviewer name instead of inventing a display name', () => {
      expect(personalReviewState(source({ enterpriseReviewedBy: { id: 'admin-1', name: null } })).reviewedBy)
        .toEqual({ id: 'admin-1', name: null });
    });

    it.each([undefined, null])('returns null when the root reviewer relation is absent (%j)', (enterpriseReviewedBy) => {
      expect(personalReviewState(source({ enterpriseReviewedBy })).reviewedBy).toBeNull();
    });

    it.each(['ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'])('recognizes %s for the exact revision even when database createdAt predates a save', (status) => {
      const transactionStartedAt = new Date('2026-10-09T06:59:00.000Z');
      const reviewer = { id: 'snapshot-admin', name: 'Snapshot Reviewer' };
      const row = source({ status: 'PERSONAL_ACTIVE', enterpriseReviewedBy: { id: 'root-admin', name: 'Root Reviewer' }, reviewSnapshots: [{
        status, createdAt: transactionStartedAt, workingCopyUpdatedAt: new Date(editedAt),
        enterpriseReviewedAt: now, rejectionReason: status === 'ENTERPRISE_REJECTED' ? 'Rejected revision' : null,
        enterpriseReviewedBy: reviewer,
        adoptedInto: status === 'ENTERPRISE_APPROVED'
          ? [{ targetVersionId: 'enterprise-reviewed', adoptedAt: transactionStartedAt }] : [],
      }] });
      expect(personalReviewState(row)).toEqual({
        reviewStatus: status, pending: false,
        isWorkingCopy: true, isLegacyUnpublished: false,
        publishedVersionId: status === 'ENTERPRISE_APPROVED' ? 'enterprise-reviewed' : null,
        enterpriseReviewedAt: now,
        rejectionReason: status === 'ENTERPRISE_REJECTED' ? 'Rejected revision' : null,
        reviewedBy: reviewer,
      });
    });

    it.each([undefined, null])('does not fall back to the root reviewer when a reviewed snapshot has no reviewer (%j)', (enterpriseReviewedBy) => {
      const row = source({
        status: 'PERSONAL_ACTIVE', enterpriseReviewedBy: { id: 'root-admin', name: 'Root Reviewer' },
        reviewSnapshots: [{
          status: 'ENTERPRISE_REJECTED', createdAt: now, workingCopyUpdatedAt: editedAt,
          enterpriseReviewedAt: now, rejectionReason: 'Unsafe revision', adoptedInto: [], enterpriseReviewedBy,
        }],
      });
      expect(personalReviewState(row)).toEqual({
        reviewStatus: 'ENTERPRISE_REJECTED', publishedVersionId: null,
        isWorkingCopy: true, isLegacyUnpublished: false, pending: false,
        enterpriseReviewedAt: now, rejectionReason: 'Unsafe revision', reviewedBy: null,
      });
    });

    it('preserves a null name for the exact-revision snapshot reviewer', () => {
      const reviewer = { id: 'snapshot-admin', name: null };
      const row = source({ status: 'PERSONAL_ACTIVE', reviewSnapshots: [{
        status: 'ENTERPRISE_REJECTED', createdAt: now, workingCopyUpdatedAt: editedAt,
        enterpriseReviewedAt: now, rejectionReason: 'Unsafe revision', adoptedInto: [], enterpriseReviewedBy: reviewer,
      }] });
      expect(personalReviewState(row).reviewedBy).toEqual(reviewer);
    });

    it('does not mark a different revision reviewed merely because its snapshot createdAt is later', () => {
      const row = source({ status: 'PERSONAL_ACTIVE', updatedAt: now, reviewSnapshots: [{
        status: 'ENTERPRISE_APPROVED', createdAt: new Date('2026-10-09T08:01:00.000Z'),
        workingCopyUpdatedAt: editedAt, enterpriseReviewedAt: editedAt, rejectionReason: null,
        enterpriseReviewedBy: { id: 'old-admin', name: 'Previous Reviewer' },
        adoptedInto: [{ targetVersionId: 'old-enterprise', adoptedAt: editedAt }],
      }] });
      expect(personalReviewState(row)).toEqual({
        reviewStatus: 'PENDING_ENTERPRISE_REVIEW', publishedVersionId: null, pending: true,
        isWorkingCopy: true, isLegacyUnpublished: false, enterpriseReviewedAt: null,
        rejectionReason: null, reviewedBy: null,
      });
    });

    it('marks an edited working copy pending again after a prior snapshot review', () => {
      const row = source({ status: 'PERSONAL_ACTIVE', updatedAt: now, reviewSnapshots: [{
        status: 'ENTERPRISE_APPROVED', createdAt: editedAt, workingCopyUpdatedAt: editedAt,
        enterpriseReviewedAt: editedAt, rejectionReason: null,
        enterpriseReviewedBy: { id: 'old-admin', name: 'Previous Reviewer' },
        adoptedInto: [{ targetVersionId: 'old-enterprise', adoptedAt: editedAt }],
      }] });
      expect(personalReviewState(row)).toEqual(expect.objectContaining({
        reviewStatus: 'PENDING_ENTERPRISE_REVIEW', publishedVersionId: null, pending: true, isWorkingCopy: true,
        reviewedBy: null,
      }));
    });

    it('recognizes historical Web adoption without a review snapshot', () => {
      expect(personalReviewState(source({ status: 'PERSONAL_ACTIVE', enterpriseReviewedBy: { id: 'root-admin', name: 'Root Reviewer' }, adoptedInto: [{
        targetVersionId: 'old-enterprise', adoptedAt: now,
      }] }))).toEqual({
        reviewStatus: 'ENTERPRISE_APPROVED', publishedVersionId: 'old-enterprise', pending: false,
        isWorkingCopy: true, isLegacyUnpublished: false, enterpriseReviewedAt: now,
        rejectionReason: null, reviewedBy: null,
      });
    });

    it('marks an approved client version without adoption as requiring explicit legacy publication', () => {
      expect(personalReviewState(source({ status: 'ENTERPRISE_APPROVED' }))).toEqual(expect.objectContaining({
        isLegacyUnpublished: true, pending: true, publishedVersionId: null,
        reviewedBy: null,
      }));
    });
  });
});

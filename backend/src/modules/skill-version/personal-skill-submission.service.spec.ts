import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EnterpriseContext } from '../enterprise/enterprise-context.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { SubmitPersonalSkillVersionDtoSchema } from 'shared';
import { Prisma } from '@prisma/client';
import { PERSONAL_SUBMISSION_SELECT, PersonalSkillSubmissionService } from './personal-skill-submission.service';

describe('PersonalSkillSubmissionService', () => {
  const ctx: EnterpriseContext = {
    enterpriseId: 'ent-1', memberId: 'member-1', departmentId: 'dept-1', role: 'ENTERPRISE_ADMIN',
  };
  const dto = {
    capabilityId: 'cap-1', parentVersionId: 'platform-v1',
    content: '---\r\nname: exact-source\r\n---\r\n\r\n# Body  \r\n',
    changeSummary: 'Update instructions',
  };
  const parent = {
    id: 'platform-v1', capabilityId: 'cap-1', scope: 'PLATFORM',
    status: 'PLATFORM_APPROVED', enterpriseId: null, ownerId: null,
  };
  const query = { status: 'PENDING_ENTERPRISE_REVIEW' as const, page: 2, limit: 10 };
  const submissionSelect = {
    id: true, capabilityId: true, parentVersionId: true, enterpriseId: true,
    ownerId: true, scope: true, version: true, status: true, changeSummary: true,
    submittedAt: true, enterpriseReviewedAt: true, rejectionReason: true,
    createdAt: true, updatedAt: true,
  };
  const reviewSelect = {
    ...submissionSelect,
    capability: { select: { id: true, name: true, description: true } },
    owner: { select: { id: true, name: true, email: true } },
  };


  function build(context: EnterpriseContext = ctx) {
    const skillVersion = {
      findUnique: jest.fn().mockImplementation(async ({ where }) => where.id === parent.id ? parent : null),
      upsert: jest.fn().mockImplementation(async ({ create }) => create),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue({ id: 'submitted-v1', status: 'PENDING_ENTERPRISE_REVIEW' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      skillVersion,
      subscription: { findFirst: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
      skillVersionReview: { create: jest.fn().mockResolvedValue({ id: 'review-1' }) },
      memberSkillVersionSelection: { upsert: jest.fn(), updateMany: jest.fn() },
      subscriptionSkillVersion: { upsert: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (operation) =>
      typeof operation === 'function' ? operation(prisma) : Promise.all(operation));
    const enterpriseContext = {
      resolve: jest.fn().mockResolvedValue(context),
      assertEnterpriseAdmin: jest.fn((value: EnterpriseContext) =>
        EnterpriseContextService.prototype.assertEnterpriseAdmin(value)),
    };
    const service = new PersonalSkillSubmissionService(prisma as never, enterpriseContext as never);
    return { service, prisma, enterpriseContext };
  }

  it('keeps the shared receipt whitelist free of body and relation fields', () => {
    expect(PERSONAL_SUBMISSION_SELECT).toEqual(submissionSelect);
  });

  describe('submit', () => {
    it('preserves frontmatter, CRLF and trailing whitespace through validation and persistence', async () => {
      const { service, prisma } = build();
      const validated = SubmitPersonalSkillVersionDtoSchema.parse(dto);
      const result = await service.submit('user-1', 'request-key-00001', validated);

      expect(result.content).toBe(dto.content);
      expect(prisma.skillVersion.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: {},
        select: { ...submissionSelect, content: true },
        create: expect.objectContaining({
          content: dto.content, parentVersionId: parent.id, ownerId: 'user-1', createdById: 'user-1',
          enterpriseId: ctx.enterpriseId, scope: 'PERSONAL', status: 'PENDING_ENTERPRISE_REVIEW',
        }),
      }));
    });

    it('returns the same saved record on a retry without creating or reviewing it again', async () => {
      const { service, prisma } = build();
      const saved = await service.submit('user-1', 'request-key-00001', dto);
      prisma.skillVersion.findUnique.mockResolvedValue(saved);
      saved.status = 'ENTERPRISE_APPROVED';

      await expect(service.submit('user-1', 'request-key-00001', dto)).resolves.toBe(saved);
      expect(prisma.skillVersion.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.skillVersionReview.create).not.toHaveBeenCalled();
    });

    it.each([
      { content: 'changed' }, { capabilityId: 'cap-2' },
      { parentVersionId: 'platform-v2' }, { changeSummary: 'different summary' },
    ])('rejects reuse of a key with different submitted fields: %j', async (change) => {
      const { service, prisma } = build();
      const saved = await service.submit('user-1', 'request-key-00001', dto);
      prisma.skillVersion.findUnique.mockResolvedValue(saved);

      await expect(service.submit('user-1', 'request-key-00001', { ...dto, ...change }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(prisma.skillVersion.upsert).toHaveBeenCalledTimes(1);
    });

    it('treats an omitted summary as the persisted null on retries', async () => {
      const { service, prisma } = build();
      const withoutSummary = { ...dto, changeSummary: undefined };
      const saved = await service.submit('user-1', 'request-key-00001', withoutSummary);
      prisma.skillVersion.findUnique.mockResolvedValue(saved);

      expect(saved.changeSummary).toBeNull();
      await expect(service.submit('user-1', 'request-key-00001', withoutSummary)).resolves.toBe(saved);
    });

    it('uses independent idempotency namespaces for users and enterprises', async () => {
      const first = await build().service.submit('user-1', 'request-key-00001', dto);
      const second = await build().service.submit('user-2', 'request-key-00001', dto);
      const third = await build({ ...ctx, enterpriseId: 'ent-2' }).service
        .submit('user-1', 'request-key-00001', dto);
      expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    });

    it.each([false, true])('checks the row returned by an upsert after a concurrent insert (conflict=%s)', async (conflict) => {
      const { service, prisma } = build();
      const concurrent = {
        ...dto, id: 'concurrent-result', content: conflict ? 'different concurrent body' : dto.content,
      };
      prisma.skillVersion.upsert.mockResolvedValue(concurrent);

      const submission = service.submit('user-1', 'request-key-00001', dto);
      if (conflict) await expect(submission).rejects.toBeInstanceOf(ConflictException);
      else await expect(submission).resolves.toBe(concurrent);
      expect(prisma.skillVersion.upsert).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('recovers a Prisma P2002 race and verifies the winning payload (conflict=%s)', async (conflict) => {
      const { service, prisma } = build();
      const winner = { ...dto, id: 'winner', content: conflict ? 'another request' : dto.content };
      prisma.skillVersion.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(parent).mockResolvedValueOnce(winner);
      prisma.skillVersion.upsert.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002', clientVersion: '6',
      }));
      const result = service.submit('user-1', 'request-key-00001', dto);
      if (conflict) await expect(result).rejects.toBeInstanceOf(ConflictException);
      else await expect(result).resolves.toBe(winner);
    });

    it.each([
      { scope: 'ENTERPRISE', enterpriseId: 'ent-other', status: 'ENTERPRISE_APPROVED' },
      { scope: 'ENTERPRISE', enterpriseId: 'ent-1', status: 'DRAFT' },
      { scope: 'PERSONAL', enterpriseId: 'ent-1', ownerId: 'user-other' },
      { scope: 'PERSONAL', enterpriseId: 'ent-other', ownerId: 'user-1' },
      { scope: 'PLATFORM', status: 'DRAFT' },
    ])('conceals an inaccessible source version: %j', async (source) => {
      const { service, prisma } = build();
      prisma.skillVersion.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...parent, ...source });

      await expect(service.submit('user-1', 'request-key-00001', dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.skillVersion.upsert).not.toHaveBeenCalled();
    });

    it.each([
      { scope: 'ENTERPRISE', enterpriseId: 'ent-1', status: 'ENTERPRISE_APPROVED' },
      { scope: 'PERSONAL', enterpriseId: 'ent-1', ownerId: 'user-1', status: 'PERSONAL_ACTIVE' },
    ])('accepts the current enterprise publication or the caller personal source: %j', async (source) => {
      const { service, prisma } = build();
      prisma.skillVersion.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...parent, ...source });
      await expect(service.submit('user-1', 'request-key-00001', dto)).resolves.toMatchObject({
        parentVersionId: dto.parentVersionId, scope: 'PERSONAL',
      });
    });

    it('rejects an accessible source belonging to a different capability', async () => {
      const { service, prisma } = build();
      prisma.skillVersion.findUnique.mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...parent, capabilityId: 'cap-other' });

      await expect(service.submit('user-1', 'request-key-00001', dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.skillVersion.upsert).not.toHaveBeenCalled();
    });
  });

  describe('authorization and version listing', () => {
    it.each(['submit', 'list'] as const)('requires an active, unexpired subscription and grant for %s', async (method) => {
      const { service, prisma } = build();
      prisma.subscription.findFirst.mockResolvedValue(null);
      const operation = method === 'submit'
        ? service.submit('user-1', 'request-key-00001', dto)
        : service.list('user-1', dto.capabilityId);
      await expect(operation).rejects.toBeInstanceOf(NotFoundException);

      const { where } = prisma.subscription.findFirst.mock.calls[0][0];
      expect(where).toEqual({
        enterpriseId: 'ent-1', status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
        employee: { bindings: { some: { capabilityId: 'cap-1', capability: { type: 'SKILL' } } } },
        grants: { some: {
          OR: [{ memberId: 'member-1' }, { departmentId: 'dept-1' }],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }],
        } },
      });
      expect(where.OR[1].endDate.gt).toEqual(where.grants.some.AND[0].OR[1].expiresAt.gt);
      expect(prisma.skillVersion.findUnique).not.toHaveBeenCalled();
      expect(prisma.skillVersion.findMany).not.toHaveBeenCalled();
    });

    it('does not match department-wide grants when the member has no department', async () => {
      const { service, prisma } = build({ ...ctx, departmentId: null });
      await service.list('user-1', dto.capabilityId);
      expect(prisma.subscription.findFirst.mock.calls[0][0].where.grants.some.OR)
        .toEqual([{ memberId: 'member-1' }]);
    });

    it('lists only released platform and current enterprise versions plus caller personal versions', async () => {
      const { service, prisma } = build();
      await service.list('user-1', 'cap-1', 'ENTERPRISE_APPROVED');
      const { where, select } = prisma.skillVersion.findMany.mock.calls[0][0];
      expect(where).toEqual({
        capabilityId: 'cap-1', status: 'ENTERPRISE_APPROVED', OR: [
          { scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
          { scope: 'ENTERPRISE', enterpriseId: 'ent-1', status: 'ENTERPRISE_APPROVED' },
          { scope: 'PERSONAL', enterpriseId: 'ent-1', ownerId: 'user-1' },
        ],
      });
      expect(select).toEqual(submissionSelect);
    });
  });

  describe('enterprise review', () => {
    it.each(['MEMBER', 'DEPT_MANAGER'] as const)('denies %s access to both the queue and review mutations', async (role) => {
      const { service, prisma } = build({ ...ctx, role });
      await expect(service.reviews('user-1', query)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.review('user-1', 'submitted-v1', { decision: 'APPROVE' }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('uses the same tenant and submission filters for paginated items and total', async () => {
      const { service, prisma } = build();
      prisma.skillVersion.count.mockResolvedValue(12);
      prisma.skillVersion.findMany.mockResolvedValue([{ id: 'submitted-v1' }]);
      await expect(service.reviews('admin-1', { ...query, capabilityId: 'cap-1' })).resolves.toEqual({
        total: 12, items: [{ id: 'submitted-v1' }], page: 2, limit: 10,
      });
      const where = {
        enterpriseId: 'ent-1', scope: 'PERSONAL', submittedAt: { not: null },
        status: 'PENDING_ENTERPRISE_REVIEW', capabilityId: 'cap-1',
      };
      expect(prisma.skillVersion.count).toHaveBeenCalledWith({ where });
      expect(prisma.skillVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 10, take: 10 }));
    });

    it.each(['PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'] as const)(
      'uses only the receipt and safe relation whitelist for %s queue items', async (status) => {
        const { service, prisma } = build();
        await service.reviews('admin-1', { ...query, status });
        const where = {
          enterpriseId: 'ent-1', scope: 'PERSONAL', submittedAt: { not: null }, status,
        };
        expect(prisma.skillVersion.count).toHaveBeenCalledWith({ where });
        expect(prisma.skillVersion.findMany).toHaveBeenCalledWith({
          where, select: reviewSelect,
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: 10, take: 10,
        });
      },
    );

    it('does not review a version outside the current enterprise or outside personal submissions', async () => {
      const { service, prisma } = build();
      prisma.skillVersion.findFirst.mockResolvedValue(null);
      await expect(service.review('admin-1', 'foreign-v1', { decision: 'APPROVE' }))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.skillVersion.findFirst).toHaveBeenCalledWith({ where: {
        id: 'foreign-v1', enterpriseId: 'ent-1', scope: 'PERSONAL', submittedAt: { not: null },
      } });
      expect(prisma.skillVersion.updateMany).not.toHaveBeenCalled();
      expect(prisma.skillVersionReview.create).not.toHaveBeenCalled();
    });

    it.each(['APPROVE', 'REJECT'] as const)('records %s with an atomic pending-status transition', async (decision) => {
      const { service, prisma } = build();
      await service.review('admin-1', 'submitted-v1', { decision, comment: 'Review feedback' });
      expect(prisma.skillVersion.updateMany).toHaveBeenCalledWith({
        where: { id: 'submitted-v1', status: 'PENDING_ENTERPRISE_REVIEW' },
        data: {
          status: decision === 'APPROVE' ? 'ENTERPRISE_APPROVED' : 'ENTERPRISE_REJECTED',
          enterpriseReviewedById: 'admin-1', enterpriseReviewedAt: expect.any(Date),
          rejectionReason: decision === 'REJECT' ? 'Review feedback' : null,
        },
      });
      expect(prisma.skillVersionReview.create).toHaveBeenCalledWith({ data: {
        versionId: 'submitted-v1', actorType: 'ENTERPRISE', decision,
        reviewerId: 'admin-1', comment: 'Review feedback',
      } });
    });

    it.each(['APPROVE', 'REJECT'] as const)(
      'persists submission → same-ID queue → %s → caller list without automatic selection', async (decision) => {
        const { service, prisma } = build();
        const capability = {
          id: 'cap-1', name: 'Personal skill', description: 'Skill description',
          config: { private: true }, content: 'must not expose capability body',
        };
        const owner = {
          id: 'user-1', name: 'Submitter', email: 'submitter@example.com',
          passwordHash: 'must not expose credentials', phone: 'private phone',
        };
        let saved: Record<string, unknown> | undefined;
        // Apply Prisma select to an in-memory persisted row, including nested relations.
        type Selection = { [field: string]: boolean | { select: Selection } };
        const project = (row: Record<string, unknown>, select: Selection): Record<string, unknown> =>
          Object.fromEntries(Object.entries(select).map(([field, selection]) => [
            field, typeof selection === 'boolean' || row[field] == null
              ? row[field]
              : project(row[field] as Record<string, unknown>, selection.select),
          ]));
        const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
          Object.entries(where).every(([field, value]) => {
            if (field === 'OR') return (value as Record<string, unknown>[]).some((branch) => matches(row, branch));
            if (value && typeof value === 'object' && 'not' in value) return row[field] != null;
            return row[field] === value;
          });
        prisma.skillVersion.findUnique.mockImplementation(async ({ where, select }) => {
          const row = where.id === parent.id ? parent : saved?.id === where.id ? saved : null;
          return row && select ? project(row, select) : row;
        });
        prisma.skillVersion.upsert.mockImplementation(async ({ create, select }) => {
          saved ??= {
            ...create, createdAt: new Date(), updatedAt: new Date(),
            enterpriseReviewedAt: null, rejectionReason: null, capability, owner,
          };
          return project(saved, select);
        });
        prisma.skillVersion.findMany.mockImplementation(async ({ where, select, skip = 0, take }) => {
          const rows = saved && matches(saved, where) ? [saved] : [];
          return rows.slice(skip, take == null ? undefined : skip + take).map((row) => project(row, select));
        });
        prisma.skillVersion.count.mockImplementation(async ({ where }) => saved && matches(saved, where) ? 1 : 0);
        prisma.skillVersion.findFirst.mockImplementation(async ({ where }) => saved && matches(saved, where) ? saved : null);
        prisma.skillVersion.updateMany.mockImplementation(async ({ where, data }) => {
          if (!saved || !matches(saved, where)) return { count: 0 };
          Object.assign(saved, data, { updatedAt: new Date() });
          return { count: 1 };
        });

        const submitted = await service.submit('user-1', 'request-key-00001', dto);
        expect(submitted).toMatchObject({ id: expect.stringMatching(/^psv_/), status: 'PENDING_ENTERPRISE_REVIEW', content: dto.content });
        expect(Object.keys(submitted).sort()).toEqual([...Object.keys(submissionSelect), 'content'].sort());
        const pending = await service.reviews('admin-1', { ...query, page: 1 });
        expect(pending.total).toBe(1);
        expect(pending.items).toEqual([expect.objectContaining({
          id: submitted.id, status: 'PENDING_ENTERPRISE_REVIEW',
          capability: { id: capability.id, name: capability.name, description: capability.description },
          owner: { id: owner.id, name: owner.name, email: owner.email },
        })]);
        expect(Object.keys(pending.items[0]).sort()).toEqual(Object.keys(reviewSelect).sort());
        await expect(service.list('user-1', 'cap-1', 'PENDING_ENTERPRISE_REVIEW'))
          .resolves.toEqual([expect.objectContaining({ id: submitted.id, status: 'PENDING_ENTERPRISE_REVIEW' })]);

        const status = decision === 'APPROVE' ? 'ENTERPRISE_APPROVED' : 'ENTERPRISE_REJECTED';
        const rejectionReason = decision === 'REJECT' ? 'Please clarify the instructions' : null;
        const receipt = await service.review('admin-1', submitted.id, {
          decision, comment: 'Please clarify the instructions',
        });
        expect(receipt).toMatchObject({ id: submitted.id, scope: 'PERSONAL', status, rejectionReason, enterpriseReviewedAt: expect.any(Date) });
        expect(Object.keys(receipt!).sort()).toEqual(Object.keys(submissionSelect).sort());
        expect(prisma.skillVersion.findUnique).toHaveBeenLastCalledWith({
          where: { id: submitted.id }, select: submissionSelect,
        });
        await expect(service.reviews('admin-1', { ...query, page: 1 }))
          .resolves.toMatchObject({ total: 0, items: [] });
        const reviewed = await service.reviews('admin-1', { ...query, status, page: 1 });
        expect(reviewed.total).toBe(1);
        expect(reviewed.items).toEqual([expect.objectContaining({ id: submitted.id, status, rejectionReason })]);
        const ownList = await service.list('user-1', 'cap-1', status);
        expect(ownList).toEqual([receipt]);
        expect(Object.keys(ownList[0]).sort()).toEqual(Object.keys(submissionSelect).sort());
        await expect(service.list('user-other', 'cap-1', status)).resolves.toEqual([]);
        await expect(service.submit('user-1', 'request-key-00001', dto))
          .resolves.toMatchObject({ id: submitted.id, status, rejectionReason, content: dto.content });
        expect(prisma.skillVersion.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.skillVersionReview.create).toHaveBeenCalledTimes(1);
        expect(prisma.memberSkillVersionSelection.upsert).not.toHaveBeenCalled();
        expect(prisma.memberSkillVersionSelection.updateMany).not.toHaveBeenCalled();
        expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
        expect(prisma.subscriptionSkillVersion.updateMany).not.toHaveBeenCalled();
      },
    );

    it('rejects the losing reviewer when another transaction already changed pending status', async () => {
      const { service, prisma } = build();
      prisma.skillVersion.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      await service.review('admin-1', 'submitted-v1', { decision: 'APPROVE' });
      await expect(service.review('admin-2', 'submitted-v1', { decision: 'REJECT', comment: 'Too late' }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(prisma.skillVersionReview.create).toHaveBeenCalledTimes(1);
      expect(prisma.skillVersion.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});

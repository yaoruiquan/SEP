import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EnterpriseContext } from '../enterprise/enterprise-context.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { SubmitPersonalSkillVersionDtoSchema } from 'shared';
import { Prisma } from '@prisma/client';
import { PersonalSkillSubmissionService } from './personal-skill-submission.service';

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

  describe('submit', () => {
    it('preserves frontmatter, CRLF and trailing whitespace through validation and persistence', async () => {
      const { service, prisma } = build();
      const validated = SubmitPersonalSkillVersionDtoSchema.parse(dto);
      const result = await service.submit('user-1', 'request-key-00001', validated);

      expect(result.content).toBe(dto.content);
      expect(prisma.skillVersion.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: {},
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
      expect(select.content).toBeUndefined();
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

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SkillVersionService } from './skill-version.service';

/**
 * 个人副本与统一审核的兼容入口。
 *
 * 覆盖的都是「写错了不报错、只会静默给出错行为」的地方：
 * 版本解析优先级、幂等、待采纳判定、采纳后是否真的切了生效版本。
 */
describe('SkillVersionService 个人副本与审核', () => {
  const ADMIN_CTX: {
    enterpriseId: string;
    memberId: string;
    departmentId: string | null;
    role: 'ENTERPRISE_ADMIN' | 'DEPT_MANAGER' | 'MEMBER';
  } = {
    enterpriseId: 'ent-1',
    memberId: 'mem-admin',
    departmentId: null,
    role: 'ENTERPRISE_ADMIN',
  };

  function build(o: {
    skillVersionFindFirst?: jest.Mock;
    txSkillVersionFindFirst?: jest.Mock;
    skillVersionFindMany?: jest.Mock;
    skillVersionCreate?: jest.Mock;
    skillVersionUpdate?: jest.Mock;
    skillVersionDelete?: jest.Mock;
    reviewSnapshotCount?: jest.Mock;
    adoptionCount?: jest.Mock;
    subscriptionFindFirst?: jest.Mock;
    subscriptionFindMany?: jest.Mock;
    subscriptionSkillVersionFindUnique?: jest.Mock;
    context?: typeof ADMIN_CTX;
  } = {}) {
    const tx = {
      skillVersion: {
        create: o.skillVersionCreate ?? jest.fn().mockResolvedValue({ id: 'ent-v2', version: '1.2.0' }),
        findFirst: o.txSkillVersionFindFirst ?? o.skillVersionFindFirst ?? jest.fn().mockResolvedValue(null),
        update: o.skillVersionUpdate ?? jest.fn().mockResolvedValue({ id: 'p1' }),
        delete: o.skillVersionDelete ?? jest.fn().mockResolvedValue({ id: 'p1' }),
        count: o.reviewSnapshotCount ?? jest.fn().mockResolvedValue(0),
      },
      skillVersionAdoption: { count: o.adoptionCount ?? jest.fn().mockResolvedValue(0) },
      subscription: { findMany: o.subscriptionFindMany ?? jest.fn().mockResolvedValue([{ id: 'sub-1' }]) },
      memberSkillVersionSelection: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      skillVersion: {
        findFirst: o.skillVersionFindFirst ?? jest.fn().mockResolvedValue(null),
        findMany: o.skillVersionFindMany ?? jest.fn().mockResolvedValue([]),
        create: o.skillVersionCreate ?? jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        delete: jest.fn().mockResolvedValue({ id: 'p1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      skillVersionAdoption: { count: jest.fn().mockResolvedValue(0) },
      subscription: {
        findFirst: o.subscriptionFindFirst ?? jest.fn().mockResolvedValue({ id: 'sub-1' }),
        findMany: o.subscriptionFindMany ?? jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1', employee: { bindings: [] } }),
      },
      memberSkillVersionSelection: { findFirst: jest.fn().mockResolvedValue(null) },
      subscriptionSkillVersion: {
        findUnique: o.subscriptionSkillVersionFindUnique ?? jest.fn().mockResolvedValue(null),
      },
      capability: { findUnique: jest.fn().mockResolvedValue({ name: '电商运营' }) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const enterpriseContext = {
      resolve: jest.fn().mockResolvedValue(o.context ?? ADMIN_CTX),
      assertEnterpriseAdmin: jest.fn((ctx: typeof ADMIN_CTX) => {
        if (ctx.role !== 'ENTERPRISE_ADMIN') throw new ForbiddenException('仅企业管理员可执行此操作');
      }),
    };
    const defaults = { get: jest.fn().mockResolvedValue(null), lock: jest.fn(), set: jest.fn() };
    const reviews = { reviewMany: jest.fn() };
    const service = new SkillVersionService(prisma as never, enterpriseContext as never, defaults as never, reviews as never);
    return { service, prisma, tx, enterpriseContext, defaults, reviews };
  }

  describe('listPersonalDiffs', () => {
    it('普通成员只看到自己的副本', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = build({
        skillVersionFindMany: findMany,
        skillVersionFindFirst: jest.fn().mockResolvedValue(null),
        context: { ...ADMIN_CTX, role: 'MEMBER' },
      });
      await service.listPersonalDiffs('u-staff', 'cap-1');
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ ownerId: 'u-staff' }) }),
      );
    });

    it('管理员看到全部成员的副本（不带 ownerId 过滤）', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = build({
        skillVersionFindMany: findMany,
        skillVersionFindFirst: jest.fn().mockResolvedValue(null),
      });
      const result = await service.listPersonalDiffs('u-admin', 'cap-1');
      expect(result.canManage).toBe(true);
      expect(findMany.mock.calls[0][0].where.ownerId).toBeUndefined();
    });

    it('审核发布后又改了一次的副本重新标为待处理', async () => {
      const adoptedAt = new Date('2026-09-01T00:00:00Z');
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'p-stale',
          status: 'PERSONAL_ACTIVE',
          owner: { id: 'u1', name: '甲', email: 'a@x' },
          parentVersion: null,
          changeSummary: null,
          content: 'v2',
          updatedAt: new Date('2026-09-02T00:00:00Z'), // 采纳之后又改
          adoptedInto: [{ id: 'a1', targetVersionId: 't1', adoptedAt, batchId: null }],
        },
        {
          id: 'p-clean',
          status: 'PERSONAL_ACTIVE',
          owner: { id: 'u2', name: '乙', email: 'b@x' },
          parentVersion: null,
          changeSummary: null,
          content: 'v1',
          updatedAt: new Date('2026-08-30T00:00:00Z'), // 采纳之前就没动过
          adoptedInto: [{ id: 'a2', targetVersionId: 't1', adoptedAt, batchId: null }],
        },
      ]);
      const { service } = build({
        skillVersionFindMany: findMany,
        skillVersionFindFirst: jest.fn().mockResolvedValue(null),
      });
      const result = await service.listPersonalDiffs('u-admin', 'cap-1');
      expect(result.items.find((i) => i.id === 'p-stale')?.pending).toBe(true);
      expect(result.items.find((i) => i.id === 'p-clean')?.pending).toBe(false);
    });

    it('客户端待审、通过、驳回记录进入同一改动列表，保留发布关联', async () => {
      const updatedAt = new Date('2026-10-09T08:00:00.000Z');
      const findMany = jest.fn().mockResolvedValue([
        { id: 'client-pending', status: 'PENDING_ENTERPRISE_REVIEW', updatedAt, ownerId: 'u-staff',
          content: '待审正文', submittedAt: updatedAt, adoptedInto: [], reviewSnapshots: [] },
        { id: 'client-approved', status: 'ENTERPRISE_APPROVED', updatedAt, ownerId: 'u-staff',
          enterpriseReviewedBy: { id: 'u-admin', name: 'Reviewer' },
          content: '已发布正文', adoptedInto: [{ targetVersionId: 'enterprise-v2', adoptedAt: updatedAt }], reviewSnapshots: [] },
        { id: 'client-rejected', status: 'ENTERPRISE_REJECTED', updatedAt, ownerId: 'u-staff',
          enterpriseReviewedBy: { id: 'u-admin', name: null },
          content: '驳回仍可自用', rejectionReason: '补充说明', adoptedInto: [], reviewSnapshots: [] },
      ]);
      const { service } = build({ skillVersionFindMany: findMany });
      const result = await service.listPersonalDiffs('u-admin', 'cap-1');
      expect(result.total).toBe(3);
      expect(result.items).toMatchObject([
        { id: 'client-pending', pending: true, canEdit: false, reviewStatus: 'PENDING_ENTERPRISE_REVIEW', reviewedBy: null },
        { id: 'client-approved', pending: false, publishedVersionId: 'enterprise-v2', adopted: true,
          reviewedBy: { id: 'u-admin', name: 'Reviewer' } },
        { id: 'client-rejected', pending: false, rejectionReason: '补充说明',
          reviewedBy: { id: 'u-admin', name: null } },
      ]);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
        scope: 'PERSONAL', enterpriseId: 'ent-1', workingCopyId: null,
        status: { in: ['PERSONAL_ACTIVE', 'PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'] },
      }) }));
    });

    it('差异基线使用企业持久默认，即使它已回退到较旧版本', async () => {
      const { service, defaults, prisma } = build();
      defaults.get.mockResolvedValue({ version: { id: 'enterprise-old', scope: 'ENTERPRISE',
        capabilityId: 'cap-1', enterpriseId: 'ent-1', status: 'ENTERPRISE_APPROVED',
        version: '1.0.0', content: '回退后的企业正文' } } as never);
      await expect(service.listPersonalDiffs('u-admin', 'cap-1')).resolves.toMatchObject({ baseline: {
        id: 'enterprise-old', version: '1.0.0', content: '回退后的企业正文',
      } });
      expect(defaults.get).toHaveBeenCalledWith('ent-1', 'cap-1');
      expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
    });

    it('先按派生审核状态分页，只读取本页个人正文', async () => {
      const updatedAt = new Date('2026-10-09T08:00:00.000Z');
      const rows = [
        { id: 'web-copy', status: 'PERSONAL_ACTIVE', updatedAt, ownerId: 'other-user',
          content: '第一页正文', adoptedInto: [], reviewSnapshots: [] },
        { id: 'published', status: 'ENTERPRISE_APPROVED', updatedAt, ownerId: 'other-user',
          content: '已发布正文', adoptedInto: [{ targetVersionId: 'enterprise-v2', adoptedAt: updatedAt }], reviewSnapshots: [] },
        { id: 'client-pending', status: 'PENDING_ENTERPRISE_REVIEW', updatedAt, ownerId: 'other-user',
          content: '第二页正文', adoptedInto: [], reviewSnapshots: [] },
      ];
      const findMany = jest.fn(async (args: { where: { id?: { in: string[] } }; select: { content?: boolean } }) => (
        args.where.id ? rows.filter((row) => args.where.id!.in.includes(row.id)) : rows
      ));
      const { service } = build({ skillVersionFindMany: findMany });
      const result = await service.listPersonalDiffs('u-admin', 'cap-1', 2, 1, 'PENDING_ENTERPRISE_REVIEW');
      expect(result).toMatchObject({ total: 2, page: 2, limit: 1,
        items: [{ id: 'client-pending', content: '第二页正文', reviewStatus: 'PENDING_ENTERPRISE_REVIEW' }] });
      const queries = findMany.mock.calls.map(([args]) => args);
      expect(queries[0].select.content).not.toBe(true);
      const contentQueries = queries.filter((args) => args.select.content);
      expect(contentQueries).toHaveLength(1);
      expect(contentQueries[0].where.id).toEqual({ in: ['client-pending'] });
    });

    describe.each(['ENTERPRISE_ADMIN', 'MEMBER'] as const)('%s 待办筛选', (role) => {
      it.each([
        { status: undefined, page: 1, limit: 20, ids: ['p4-web', 'p3-client', 'p2-legacy', 'p1-legacy-copy', 'published', 'rejected'], total: 6 },
        { status: 'PENDING_ENTERPRISE_REVIEW', page: 1, limit: 20, ids: ['p4-web', 'p3-client', 'p2-legacy', 'p1-legacy-copy'], total: 4 },
        { status: 'PENDING_ENTERPRISE_REVIEW', page: 2, limit: 2, ids: ['p2-legacy', 'p1-legacy-copy'], total: 4 },
        { status: 'PENDING_ENTERPRISE_REVIEW', page: 3, limit: 2, ids: [], total: 4 },
        { status: 'ENTERPRISE_APPROVED', page: 1, limit: 20, ids: ['p2-legacy', 'p1-legacy-copy', 'published'], total: 3 },
        { status: 'ENTERPRISE_REJECTED', page: 1, limit: 20, ids: ['rejected'], total: 1 },
      ])('$status 第 $page 页与派生待办一致，保留审核状态语义', async ({ status, page, limit, ids, total }) => {
        const updatedAt = new Date('2026-10-09T08:00:00.000Z');
        const common = { updatedAt, ownerId: 'u-staff', adoptedInto: [], reviewSnapshots: [] };
        const rows = [
          { ...common, id: 'p4-web', status: 'PERSONAL_ACTIVE', content: 'Web 待审正文' },
          { ...common, id: 'p3-client', status: 'PENDING_ENTERPRISE_REVIEW', content: '客户端待审正文' },
          { ...common, id: 'p2-legacy', status: 'ENTERPRISE_APPROVED', content: '历史通过未发布正文' },
          { ...common, id: 'p1-legacy-copy', status: 'PERSONAL_ACTIVE', content: '历史通过未发布副本',
            reviewSnapshots: [{ status: 'ENTERPRISE_APPROVED', createdAt: updatedAt,
              workingCopyUpdatedAt: updatedAt, enterpriseReviewedAt: updatedAt,
              rejectionReason: null, adoptedInto: [] }] },
          { ...common, id: 'published', status: 'ENTERPRISE_APPROVED', content: '已发布正文',
            adoptedInto: [{ targetVersionId: 'enterprise-v2', adoptedAt: updatedAt }] },
          { ...common, id: 'rejected', status: 'ENTERPRISE_REJECTED', content: '已拒绝正文' },
        ];
        const findMany = jest.fn(async (args: { where: { id?: { in: string[] }; ownerId?: string }; select: { content?: boolean } }) => (
          args.where.id ? rows.filter((row) => args.where.id!.in.includes(row.id)) : rows
        ));
        const { service } = build({ skillVersionFindMany: findMany, context: { ...ADMIN_CTX, role } });

        const result = await service.listPersonalDiffs('u-staff', 'cap-1', page, limit, status);

        expect(result).toMatchObject({ total, pendingTotal: 4, page, limit,
          canManage: role === 'ENTERPRISE_ADMIN', myWorkingCopy: null });
        expect(result.items.map((row) => row.id)).toEqual(ids);
        expect(result.items.map((row) => row.content)).toEqual(ids.map((id) => rows.find((row) => row.id === id)!.content));
        if (status === 'PENDING_ENTERPRISE_REVIEW') {
          expect(result.total).toBe(result.pendingTotal);
          expect(result.items.every((row) => row.pending)).toBe(true);
        }
        for (const row of result.items.filter((item) => item.id.startsWith('p2-') || item.id.startsWith('p1-'))) {
          expect(row).toMatchObject({ pending: true, isLegacyUnpublished: true, reviewStatus: 'ENTERPRISE_APPROVED' });
        }
        const queries = findMany.mock.calls.map(([args]) => args);
        expect(queries[0].select.content).not.toBe(true);
        const contentQueries = queries.filter((args) => args.select.content);
        expect(contentQueries).toHaveLength(ids.length ? 1 : 0);
        if (ids.length) expect(contentQueries[0].where.id).toEqual({ in: ids });
        for (const query of [queries[0], ...contentQueries]) {
          expect(query.where).toMatchObject({ enterpriseId: 'ent-1', capabilityId: 'cap-1', scope: 'PERSONAL' });
          expect(query.where.ownerId).toBe(role === 'MEMBER' ? 'u-staff' : undefined);
        }
      });
    });

    it('待办筛选不绕过技能可读权限', async () => {
      const { service, prisma } = build({
        context: { ...ADMIN_CTX, role: 'MEMBER' },
        subscriptionFindFirst: jest.fn().mockResolvedValue(null),
      });
      await expect(service.listPersonalDiffs('u-staff', 'cap-1', 1, 20, 'PENDING_ENTERPRISE_REVIEW'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.skillVersion.findMany).not.toHaveBeenCalled();
    });
  });

  describe('adoptPersonalVersions 兼容统一审核', () => {

    it('单来源兼容 expectedUpdatedAt 并保留空批次号', async () => {
      const { service, reviews } = build();
      reviews.reviewMany.mockResolvedValue({ sources: [{ id: 'p1' }], batchId: null, affectedSubscriptions: 1 });
      await expect(service.adoptPersonalVersions('u-admin', 'cap-1', {
        sourceVersionIds: ['p1'], expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
      })).resolves.toMatchObject({ adoptedCount: 1, batchId: null });
      expect(reviews.reviewMany).toHaveBeenCalledWith('u-admin', ['p1'],
        { decision: 'APPROVE', comment: undefined }, { p1: '2026-10-09T00:00:00.000Z' }, 'cap-1', undefined);
    });

    it('逐版本并发凭证优先于旧单来源凭证', async () => {
      const { service, reviews } = build();
      reviews.reviewMany.mockResolvedValue({ sources: [{ id: 'p1' }] });
      await service.adoptPersonalVersions('u-admin', 'cap-1', {
        sourceVersionIds: ['p1'], expectedUpdatedAt: 'old', expectedVersions: { p1: 'current' },
      });
      expect(reviews.reviewMany).toHaveBeenCalledWith('u-admin', ['p1'],
        { decision: 'APPROVE', comment: undefined }, { p1: 'current' }, 'cap-1', undefined);
    });

    it.each([ForbiddenException, NotFoundException, ConflictException])(
      '透传统一审核的权限、租户与并发错误 %p，不执行旧事务', async (Exception) => {
        const { service, prisma, reviews } = build();
        const error = new Exception('审核被拒绝');
        reviews.reviewMany.mockRejectedValue(error);
        await expect(service.adoptPersonalVersions('u-staff', 'cap-1', {
          sourceVersionIds: ['p1'],
        })).rejects.toBe(error);
        expect(reviews.reviewMany).toHaveBeenCalledWith('u-staff', ['p1'],
          { decision: 'APPROVE', comment: undefined }, {}, 'cap-1', undefined);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });
});

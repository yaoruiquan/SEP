import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SkillVersionService } from './skill-version.service';

/**
 * 个人副本与采纳（会议纪要2 §6.4）。
 *
 * 覆盖的都是「写错了不报错、只会静默给出错行为」的地方：
 * 版本解析优先级、幂等、待采纳判定、采纳后是否真的切了生效版本。
 */
describe('SkillVersionService 个人副本与采纳', () => {
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
    skillVersionFindMany?: jest.Mock;
    skillVersionCreate?: jest.Mock;
    skillVersionUpdate?: jest.Mock;
    skillVersionDelete?: jest.Mock;
    adoptionCount?: jest.Mock;
    adoptionCreateMany?: jest.Mock;
    subscriptionFindFirst?: jest.Mock;
    subscriptionFindMany?: jest.Mock;
    subscriptionSkillVersionUpsert?: jest.Mock;
    subscriptionSkillVersionFindUnique?: jest.Mock;
    notificationCreateMany?: jest.Mock;
    memberFindMany?: jest.Mock;
    enterpriseVersions?: Array<{ version: string }>;
    context?: typeof ADMIN_CTX;
  } = {}) {
    const tx = {
      skillVersion: { create: o.skillVersionCreate ?? jest.fn().mockResolvedValue({ id: 'ent-v2', version: '1.2.0' }) },
      skillVersionAdoption: { createMany: o.adoptionCreateMany ?? jest.fn().mockResolvedValue({ count: 1 }) },
      subscription: { findMany: o.subscriptionFindMany ?? jest.fn().mockResolvedValue([{ id: 'sub-1' }]) },
      subscriptionSkillVersion: { upsert: o.subscriptionSkillVersionUpsert ?? jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      skillVersion: {
        findFirst: o.skillVersionFindFirst ?? jest.fn().mockResolvedValue(null),
        // 采纳流程会查两次 findMany：先查 PERSONAL 来源，再查 ENTERPRISE 现有版本号。
        // 用一个 mock 同时喂两者会让 nextSemver 读到没有 version 字段的对象。
        findMany: jest.fn((args: { where?: { scope?: string } }) => {
          if (args?.where?.scope === 'ENTERPRISE') {
            return Promise.resolve(o.enterpriseVersions ?? [{ version: '1.1.0' }]);
          }
          return (o.skillVersionFindMany ?? jest.fn().mockResolvedValue([]))(args);
        }),
        create: o.skillVersionCreate ?? jest.fn().mockResolvedValue({ id: 'p1' }),
        update: o.skillVersionUpdate ?? jest.fn().mockResolvedValue({ id: 'p1' }),
        delete: o.skillVersionDelete ?? jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      skillVersionAdoption: { count: o.adoptionCount ?? jest.fn().mockResolvedValue(0) },
      subscription: {
        findFirst: o.subscriptionFindFirst ?? jest.fn().mockResolvedValue({ id: 'sub-1' }),
        findMany: o.subscriptionFindMany ?? jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      subscriptionSkillVersion: {
        findUnique: o.subscriptionSkillVersionFindUnique ?? jest.fn().mockResolvedValue(null),
      },
      capability: { findUnique: jest.fn().mockResolvedValue({ name: '电商运营' }) },
      enterpriseMember: { findMany: o.memberFindMany ?? jest.fn().mockResolvedValue([{ userId: 'u1' }]) },
      notification: { createMany: o.notificationCreateMany ?? jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const enterpriseContext = {
      resolve: jest.fn().mockResolvedValue(o.context ?? ADMIN_CTX),
      assertEnterpriseAdmin: jest.fn((ctx: typeof ADMIN_CTX) => {
        if (ctx.role !== 'ENTERPRISE_ADMIN') throw new ForbiddenException('仅企业管理员可执行此操作');
      }),
    };
    const service = new SkillVersionService(prisma as never, enterpriseContext as never);
    return { service, prisma, tx, enterpriseContext };
  }

  describe('resolveEffectiveVersion 的 PERSONAL 层', () => {
    it('传了 userId 且该成员有副本时，个人副本胜过企业选版', async () => {
      const personal = { id: 'p1', scope: 'PERSONAL', content: '我的版本' };
      const findFirst = jest.fn().mockResolvedValue(personal);
      const subscriptionSkillVersionFindUnique = jest
        .fn()
        .mockResolvedValue({ version: { id: 'ent-v1', content: '企业版' } });
      const { service } = build({
        skillVersionFindFirst: findFirst,
        subscriptionSkillVersionFindUnique,
      });

      await expect(service.resolveEffectiveVersion('sub-1', 'cap-1', 'u-staff')).resolves.toBe(personal);
      // 命中个人副本就不该再查企业选版
      expect(subscriptionSkillVersionFindUnique).not.toHaveBeenCalled();
    });

    it('不传 userId 时跳过 PERSONAL 层，回到企业选版', async () => {
      const findFirst = jest.fn().mockResolvedValue({ id: 'p1' });
      const entVersion = { id: 'ent-v1', content: '企业版' };
      const { service } = build({
        skillVersionFindFirst: findFirst,
        subscriptionSkillVersionFindUnique: jest.fn().mockResolvedValue({ version: entVersion }),
      });

      await expect(service.resolveEffectiveVersion('sub-1', 'cap-1')).resolves.toBe(entVersion);
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('该成员没有副本时落到企业选版', async () => {
      const entVersion = { id: 'ent-v1' };
      const { service } = build({
        skillVersionFindFirst: jest.fn().mockResolvedValue(null),
        subscriptionSkillVersionFindUnique: jest.fn().mockResolvedValue({ version: entVersion }),
      });
      await expect(service.resolveEffectiveVersion('sub-1', 'cap-1', 'u-staff')).resolves.toBe(entVersion);
    });

    it('只认 PERSONAL_ACTIVE —— 归档的副本不参与解析', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const { service } = build({
        skillVersionFindFirst: findFirst,
        subscriptionSkillVersionFindUnique: jest.fn().mockResolvedValue({ version: { id: 'ent-v1' } }),
      });
      await service.resolveEffectiveVersion('sub-1', 'cap-1', 'u-staff');
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PERSONAL_ACTIVE', ownerId: 'u-staff' }),
        }),
      );
    });
  });

  describe('createPersonalVersion', () => {
    it('已有副本时直接返回，不建第二条', async () => {
      const existing = { id: 'p1', scope: 'PERSONAL', content: '我的' };
      const create = jest.fn();
      const { service } = build({
        skillVersionFindFirst: jest.fn().mockResolvedValue(existing),
        skillVersionCreate: create,
      });
      await expect(service.createPersonalVersion('u-staff', 'cap-1')).resolves.toBe(existing);
      expect(create).not.toHaveBeenCalled();
    });

    it('副本的起点是当前生效版本，不是平台原版', async () => {
      // 第一次 findFirst（查已有副本）返回 null，之后 resolveEffectiveVersion 内部再查
      const findFirst = jest.fn().mockResolvedValue(null);
      const create = jest.fn().mockResolvedValue({ id: 'p-new' });
      const { service } = build({
        skillVersionFindFirst: findFirst,
        skillVersionCreate: create,
        subscriptionSkillVersionFindUnique: jest
          .fn()
          .mockResolvedValue({ version: { id: 'ent-v1', version: '1.1.0', content: '企业定制正文' } }),
      });

      await service.createPersonalVersion('u-staff', 'cap-1');
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scope: 'PERSONAL',
            status: 'PERSONAL_ACTIVE',
            ownerId: 'u-staff',
            parentVersionId: 'ent-v1',
            content: '企业定制正文',
          }),
        }),
      );
    });

    it('没有任何可用版本时报 404，而不是建一个空副本', async () => {
      const { service } = build({
        skillVersionFindFirst: jest.fn().mockResolvedValue(null),
        subscriptionSkillVersionFindUnique: jest.fn().mockResolvedValue(null),
      });
      await expect(service.createPersonalVersion('u-staff', 'cap-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('没有授权的成员不能建副本', async () => {
      const { service } = build({ subscriptionFindFirst: jest.fn().mockResolvedValue(null) });
      await expect(service.createPersonalVersion('u-out', 'cap-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('updatePersonalVersion / discardPersonalVersion', () => {
    it('别人的副本改不了', async () => {
      const { service } = build({ skillVersionFindFirst: jest.fn().mockResolvedValue(null) });
      await expect(
        service.updatePersonalVersion('u-other', 'p1', { content: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('归档的副本不能再编辑', async () => {
      const { service } = build({
        skillVersionFindFirst: jest.fn().mockResolvedValue({ id: 'p1', status: 'ARCHIVED' }),
      });
      await expect(
        service.updatePersonalVersion('u-staff', 'p1', { content: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('被采纳过的副本弃用时归档而不删除', async () => {
      const del = jest.fn();
      const update = jest.fn().mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
      const { service } = build({
        skillVersionFindFirst: jest.fn().mockResolvedValue({ id: 'p1', status: 'PERSONAL_ACTIVE' }),
        adoptionCount: jest.fn().mockResolvedValue(2),
        skillVersionDelete: del,
        skillVersionUpdate: update,
      });
      await service.discardPersonalVersion('u-staff', 'p1');
      expect(del).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ARCHIVED' } }),
      );
    });

    it('从未被采纳的副本可以物理删除', async () => {
      const del = jest.fn().mockResolvedValue({ id: 'p1' });
      const { service } = build({
        skillVersionFindFirst: jest.fn().mockResolvedValue({ id: 'p1', status: 'PERSONAL_ACTIVE' }),
        adoptionCount: jest.fn().mockResolvedValue(0),
        skillVersionDelete: del,
      });
      await expect(service.discardPersonalVersion('u-staff', 'p1')).resolves.toEqual({
        id: 'p1',
        deleted: true,
      });
      expect(del).toHaveBeenCalled();
    });
  });

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

    it('采纳后又改了一次的副本重新标为待处理', async () => {
      const adoptedAt = new Date('2026-09-01T00:00:00Z');
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'p-stale',
          owner: { id: 'u1', name: '甲', email: 'a@x' },
          parentVersion: null,
          changeSummary: null,
          content: 'v2',
          updatedAt: new Date('2026-09-02T00:00:00Z'), // 采纳之后又改
          adoptedInto: [{ id: 'a1', targetVersionId: 't1', adoptedAt, batchId: null }],
        },
        {
          id: 'p-clean',
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
  });

  describe('adoptPersonalVersions', () => {
    const sources = [
      {
        id: 'p1',
        content: '甲的正文',
        changeSummary: '加了术语规范',
        updatedAt: new Date('2026-09-01T00:00:00Z'),
        owner: { id: 'u1', name: '甲总' },
      },
      {
        id: 'p2',
        content: '乙的正文',
        changeSummary: '补了话术',
        updatedAt: new Date('2026-09-02T00:00:00Z'),
        owner: { id: 'u2', name: '技术员' },
      },
    ];

    it('普通成员不能采纳', async () => {
      const { service } = build({ context: { ...ADMIN_CTX, role: 'MEMBER' } });
      await expect(
        service.adoptPersonalVersions('u-staff', 'cap-1', { sourceVersionIds: ['p1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('传入的 id 有一个不属于本企业就整体拒绝', async () => {
      const { service } = build({
        skillVersionFindMany: jest.fn().mockResolvedValue([sources[0]]),
      });
      await expect(
        service.adoptPersonalVersions('u-admin', 'cap-1', { sourceVersionIds: ['p1', 'p-alien'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('一键采纳多人：生成企业版、写全部采纳记录、带同一个批次号', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'ent-v2', version: '1.2.0' });
      const createMany = jest.fn().mockResolvedValue({ count: 2 });
      const { service } = build({
        skillVersionFindMany: jest.fn().mockResolvedValue(sources),
        skillVersionCreate: create,
        adoptionCreateMany: createMany,
      });

      const result = await service.adoptPersonalVersions('u-admin', 'cap-1', {
        sourceVersionIds: ['p1', 'p2'],
      });

      expect(result.adoptedCount).toBe(2);
      expect(result.batchId).toBeTruthy();
      // 最后更新的那条正文胜出
      expect(create.mock.calls[0][0].data.content).toBe('乙的正文');
      // 采纳直接生效，不再进审核流
      expect(create.mock.calls[0][0].data.status).toBe('ENTERPRISE_APPROVED');
      // 变更说明必须列出全部来源，否则采纳完无从追溯
      expect(create.mock.calls[0][0].data.changeSummary).toContain('甲总');
      expect(create.mock.calls[0][0].data.changeSummary).toContain('技术员');
      const rows = createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r: { batchId: string }) => r.batchId)).size).toBe(1);
    });

    it('逐条采纳（单个 id）不带批次号', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'ent-v2', version: '1.2.0' });
      const { service } = build({
        skillVersionFindMany: jest.fn().mockResolvedValue([sources[0]]),
        skillVersionCreate: create,
      });
      const result = await service.adoptPersonalVersions('u-admin', 'cap-1', {
        sourceVersionIds: ['p1'],
      });
      expect(result.batchId).toBeNull();
      expect(create.mock.calls[0][0].data.content).toBe('甲的正文');
    });

    it('采纳后把生效版本切到新企业版 —— 不切等于什么都没发生', async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const { service } = build({
        skillVersionFindMany: jest.fn().mockResolvedValue([sources[0]]),
        subscriptionFindMany: jest.fn().mockResolvedValue([{ id: 'sub-1' }, { id: 'sub-2' }]),
        subscriptionSkillVersionUpsert: upsert,
      });
      const result = await service.adoptPersonalVersions('u-admin', 'cap-1', {
        sourceVersionIds: ['p1'],
      });
      expect(result.affectedSubscriptions).toBe(2);
      expect(upsert).toHaveBeenCalledTimes(2);
    });

    it('通知发送失败不影响采纳结果', async () => {
      const { service } = build({
        skillVersionFindMany: jest.fn().mockResolvedValue([sources[0]]),
        notificationCreateMany: jest.fn().mockRejectedValue(new Error('通知服务挂了')),
      });
      await expect(
        service.adoptPersonalVersions('u-admin', 'cap-1', { sourceVersionIds: ['p1'] }),
      ).resolves.toMatchObject({ adoptedCount: 1 });
    });

    it('通知发给企业全体成员', async () => {
      const createMany = jest.fn().mockResolvedValue({ count: 3 });
      const { service } = build({
        skillVersionFindMany: jest.fn().mockResolvedValue([sources[0]]),
        memberFindMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]),
        notificationCreateMany: createMany,
      });
      await service.adoptPersonalVersions('u-admin', 'cap-1', { sourceVersionIds: ['p1'] });
      expect(createMany.mock.calls[0][0].data).toHaveLength(3);
      expect(createMany.mock.calls[0][0].data[0].type).toBe('SKILL_VERSION_UPDATED');
    });
  });
});

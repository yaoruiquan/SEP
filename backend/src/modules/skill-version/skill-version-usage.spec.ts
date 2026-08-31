import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SkillVersionService } from './skill-version.service';

/**
 * 阶段二新增的三个读接口（能力列表 / 版本时间线 / 使用统计 / 执行明细）
 * 共用一把授权关。这里覆盖的是「关得住吗」和「统计算得对吗」——
 * 两者都是「写错了不会报错、只会静默给出错数据」的地方。
 */
describe('SkillVersionService 使用记录与统计', () => {
  const ADMIN_CTX = {
    enterpriseId: 'ent-1',
    memberId: 'mem-admin',
    departmentId: null,
    role: 'ENTERPRISE_ADMIN' as const,
  };

  function build(overrides: {
    subscriptionFindFirst?: jest.Mock;
    subscriptionFindMany?: jest.Mock;
    toolExecutionFindMany?: jest.Mock;
    toolExecutionGroupBy?: jest.Mock;
    capabilityFindUnique?: jest.Mock;
    skillVersionFindMany?: jest.Mock;
    subscriptionSkillVersionFindUnique?: jest.Mock;
  } = {}) {
    const prisma = {
      subscription: {
        findFirst: overrides.subscriptionFindFirst ?? jest.fn().mockResolvedValue({ id: 'sub-1' }),
        findMany: overrides.subscriptionFindMany ?? jest.fn().mockResolvedValue([]),
      },
      toolExecution: {
        findMany: overrides.toolExecutionFindMany ?? jest.fn().mockResolvedValue([]),
        groupBy: overrides.toolExecutionGroupBy ?? jest.fn().mockResolvedValue([]),
      },
      capability: {
        findUnique:
          overrides.capabilityFindUnique ??
          jest.fn().mockResolvedValue({ id: 'cap-1', name: '电商运营', description: '' }),
      },
      skillVersion: {
        findMany: overrides.skillVersionFindMany ?? jest.fn().mockResolvedValue([]),
      },
      subscriptionSkillVersion: {
        findUnique: overrides.subscriptionSkillVersionFindUnique ?? jest.fn().mockResolvedValue(null),
      },
    };
    const enterpriseContext = { resolve: jest.fn().mockResolvedValue(ADMIN_CTX) };
    const service = new SkillVersionService(prisma as never, enterpriseContext as never);
    return { service, prisma, enterpriseContext };
  }

  describe('授权关', () => {
    it('没有授权订阅时，版本时间线拒绝访问', async () => {
      const { service } = build({ subscriptionFindFirst: jest.fn().mockResolvedValue(null) });
      await expect(service.listVersionTimeline('u1', 'cap-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('没有授权订阅时，使用统计同样拒绝 —— 三个接口不能有一个漏掉', async () => {
      const { service } = build({ subscriptionFindFirst: jest.fn().mockResolvedValue(null) });
      await expect(service.getUsageSummary('u1', 'cap-1', true)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('没有授权订阅时，执行明细同样拒绝', async () => {
      const { service } = build({ subscriptionFindFirst: jest.fn().mockResolvedValue(null) });
      await expect(service.getExecutionDetails('u1', 'cap-1', 20)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('授权关按「订阅的员工绑定了这个能力」判定，而不只是「企业有这个订阅」', async () => {
      const findFirst = jest.fn().mockResolvedValue({ id: 'sub-1' });
      const { service } = build({ subscriptionFindFirst: findFirst });
      await service.getUsageSummary('u1', 'cap-1', false);

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employee: { bindings: { some: { capabilityId: 'cap-1' } } },
          }),
        }),
      );
    });
  });

  describe('getUsageSummary', () => {
    const executions = [
      execution('e1', 'u-boss', 'sess-1', 'emp-1', '电商专家'),
      execution('e2', 'u-boss', 'sess-1', 'emp-1', '电商专家'),
      execution('e3', 'u-staff', 'sess-2', 'emp-1', '电商专家'),
      // userId 为空的历史记录（B2 之前落的库）不该被算进「使用人数」
      execution('e4', null, 'sess-2', 'emp-1', '电商专家'),
    ];

    it('会话与用户各自去重，调用轮次按行数算', async () => {
      const { service } = build({
        toolExecutionFindMany: jest.fn().mockResolvedValue(executions),
      });
      const result = await service.getUsageSummary('u1', 'cap-1', true);

      expect(result.summary).toEqual({
        distinctUserCount: 2, // u-boss、u-staff；null 不计
        totalConversations: 2, // sess-1、sess-2
        totalRounds: 4,
      });
    });

    it('按员工聚合把同一员工的多次调用合并', async () => {
      const { service } = build({
        toolExecutionFindMany: jest.fn().mockResolvedValue([
          ...executions,
          execution('e5', 'u-boss', 'sess-3', 'emp-2', '直播教练'),
        ]),
      });
      const result = await service.getUsageSummary('u1', 'cap-1', true);

      expect(result.byEmployee).toEqual([
        { employeeId: 'emp-1', employeeName: '电商专家', rounds: 4 },
        { employeeId: 'emp-2', employeeName: '直播教练', rounds: 1 },
      ]);
    });

    it('管理员拿到 byMember', async () => {
      const { service } = build({
        toolExecutionFindMany: jest.fn().mockResolvedValue(executions),
      });
      const result = await service.getUsageSummary('u1', 'cap-1', true);

      expect(result.byMember).toEqual([
        { userId: 'u-boss', userName: '甲总', rounds: 2 },
        { userId: 'u-staff', userName: '甲总', rounds: 1 },
      ]);
    });

    it('非管理员拿不到 byMember —— 那里面是成员的使用明细', async () => {
      const { service } = build({
        toolExecutionFindMany: jest.fn().mockResolvedValue(executions),
      });
      const result = await service.getUsageSummary('u1', 'cap-1', false);

      expect(result.byMember).toBeUndefined();
      // 但总览和按员工两层照常返回
      expect(result.summary.distinctUserCount).toBe(2);
      expect(result.byEmployee).toHaveLength(1);
    });
  });

  describe('getExecutionDetails', () => {
    it('版本作用域展平成 versionScope，供前端打「企业版 / 平台版」标签', async () => {
      const { service } = build({
        toolExecutionFindMany: jest.fn().mockResolvedValue([
          {
            id: 'e1',
            sessionId: 'sess-1',
            input: { query: 'x' },
            output: { text: 'y' },
            status: 'SUCCESS',
            errorMessage: null,
            duration: 1200,
            skillVersionId: 'sv-ent',
            skillVersion: { scope: 'ENTERPRISE' },
            userId: 'u-boss',
            user: { name: '甲总' },
            createdAt: new Date('2026-08-30T10:00:00.000Z'),
          },
        ]),
      });

      const result = await service.getExecutionDetails('u1', 'cap-1', 20);

      expect(result.items[0]).toMatchObject({
        versionScope: 'ENTERPRISE',
        userName: '甲总',
        createdAt: '2026-08-30T10:00:00.000Z',
      });
    });

    it('没有版本归属的历史记录 versionScope 为 null，不假装是平台版', async () => {
      const { service } = build({
        toolExecutionFindMany: jest.fn().mockResolvedValue([
          {
            id: 'e1',
            sessionId: 'sess-1',
            input: {},
            output: null,
            status: 'SUCCESS',
            errorMessage: null,
            duration: null,
            skillVersionId: null,
            skillVersion: null,
            userId: null,
            user: null,
            createdAt: new Date('2026-08-30T10:00:00.000Z'),
          },
        ]),
      });

      const result = await service.getExecutionDetails('u1', 'cap-1', 20);
      expect(result.items[0].versionScope).toBeNull();
      expect(result.items[0].userName).toBeNull();
    });

    it('满页时给出游标，不满页时为 null —— 否则前端会多请求一次空页', async () => {
      const row = (id: string) => ({
        id,
        sessionId: 's',
        input: {},
        output: null,
        status: 'SUCCESS' as const,
        errorMessage: null,
        duration: null,
        skillVersionId: null,
        skillVersion: null,
        userId: null,
        user: null,
        createdAt: new Date('2026-08-30T10:00:00.000Z'),
      });

      const full = build({ toolExecutionFindMany: jest.fn().mockResolvedValue([row('a'), row('b')]) });
      expect((await full.service.getExecutionDetails('u1', 'cap-1', 2)).nextCursor).toBe(
        '2026-08-30T10:00:00.000Z',
      );

      const partial = build({ toolExecutionFindMany: jest.fn().mockResolvedValue([row('a')]) });
      expect((await partial.service.getExecutionDetails('u1', 'cap-1', 2)).nextCursor).toBeNull();
    });

    it('游标转成 createdAt < cursor 的过滤条件', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = build({ toolExecutionFindMany: findMany });
      await service.getExecutionDetails('u1', 'cap-1', 20, '2026-08-30T10:00:00.000Z');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lt: new Date('2026-08-30T10:00:00.000Z') },
          }),
        }),
      );
    });
  });

  describe('listVersionTimeline', () => {
    it('标出当前生效版本，其余为 false', async () => {
      const { service } = build({
        skillVersionFindMany: jest.fn().mockResolvedValue([
          { id: 'sv-ent', version: '1.1.0', scope: 'ENTERPRISE', promotedVersions: [], reviews: [] },
          { id: 'sv-plat', version: '1.0.0', scope: 'PLATFORM', promotedVersions: [], reviews: [] },
        ]),
        subscriptionSkillVersionFindUnique: jest
          .fn()
          .mockResolvedValue({ versionId: 'sv-ent', selectedAt: new Date('2026-08-28T00:00:00.000Z') }),
      });

      const result = await service.listVersionTimeline('u1', 'cap-1');

      expect(result.currentVersionId).toBe('sv-ent');
      expect(result.versions.map((v) => [v.id, v.isCurrent])).toEqual([
        ['sv-ent', true],
        ['sv-plat', false],
      ]);
    });

    it('没有选版记录时 currentVersionId 为 null —— 执行时会兜底到平台版', async () => {
      const { service } = build({
        skillVersionFindMany: jest.fn().mockResolvedValue([
          { id: 'sv-plat', version: '1.0.0', scope: 'PLATFORM', promotedVersions: [], reviews: [] },
        ]),
      });

      const result = await service.listVersionTimeline('u1', 'cap-1');
      expect(result.currentVersionId).toBeNull();
      expect(result.versions[0].isCurrent).toBe(false);
    });

    it('企业版把草稿与待审也列出来 —— 否则「我提交的那版去哪了」无从回答', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const { service } = build({ skillVersionFindMany: findMany });
      await service.listVersionTimeline('u1', 'cap-1');

      const where = findMany.mock.calls[0][0].where;
      // 平台版只要审核通过的，企业版不限状态
      expect(where.OR).toEqual([
        { scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
        { scope: 'ENTERPRISE', enterpriseId: 'ent-1' },
      ]);
    });

    it('能力不存在时抛 NotFound', async () => {
      const { service } = build({ capabilityFindUnique: jest.fn().mockResolvedValue(null) });
      await expect(service.listVersionTimeline('u1', 'cap-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

function execution(
  id: string,
  userId: string | null,
  sessionId: string,
  employeeId: string,
  employeeName: string,
) {
  return {
    id,
    sessionId,
    userId,
    skillVersionId: 'sv-ent',
    session: { employeeId, employee: { name: employeeName } },
    user: userId ? { name: '甲总' } : null,
  };
}

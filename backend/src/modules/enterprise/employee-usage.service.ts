import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { MyEmployeeUsage } from 'shared';

/** 「在用人数」和「执行成功率」共用的观察窗口。会议2 §6.1 用的就是 30 天口径。 */
const ACTIVE_WINDOW_DAYS = 30;

/** 一张待补数据的员工卡片。同一 employeeId 只可能对应一个订阅（见 Subscription 的唯一约束）。 */
export interface UsageTarget {
  subscriptionId: string;
  employeeId: string;
}

/** 能力执行的成败计数，按 employeeId 归集。 */
interface ExecutionTally {
  employeeId: string;
  total: number;
  success: number;
}

/**
 * 员工卡片上的使用情况聚合。
 *
 * 为什么单独一个 service：这五个数字的口径（窗口、租户边界、空值语义）
 * 比取数动作本身麻烦得多，塞进 GrantService 会把「谁能用哪个员工」
 * 这条主线埋掉。
 *
 * **查询数与卡片数无关**，共 6 条、分两轮：卡片有 3 张还是 30 张都一样。
 * 逐卡片查 `/digital-employees/:id/stats` 是 N+1，8 张卡打 8 个请求 ——
 * 这正是 §4.4 明确禁止的做法。
 */
@Injectable()
export class EmployeeUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 批量取回若干订阅的使用情况，按 subscriptionId 归集。
   *
   * 全部限定在 `enterpriseId` 内。跨企业聚合会让 A 企业从「上次使用」
   * 反推出 B 企业在用同一个员工 —— 这是多租户泄漏，不只是数字不准。
   */
  async forSubscriptions(
    enterpriseId: string,
    targets: UsageTarget[],
  ): Promise<Map<string, MyEmployeeUsage>> {
    const result = new Map<string, MyEmployeeUsage>();
    if (targets.length === 0) return result;

    const employeeIds = [...new Set(targets.map((t) => t.employeeId))];
    const subscriptionIds = targets.map((t) => t.subscriptionId);
    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - ACTIVE_WINDOW_DAYS);
    // 「本月」用自然月而非滚动 30 天：卡片上的消费要能和账单、
    // 和算力余额页的「本月算力消费」对得上，那两处都是自然月。
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const scoped = { enterpriseId, employeeId: { in: employeeIds } };

    const [activeRows, monthRows, lastUsedRows, grantRows, execRows] =
      await Promise.all([
        // ① 近 30 天在用人数。Prisma 的 groupBy 没有 COUNT(DISTINCT)，
        //    故按 (employeeId, userId) 分组后在内存里数组合数 —— 行数是
        //    「员工 × 用过的人」，与账单条数无关，不会膨胀。
        this.prisma.computeUsageRecord.groupBy({
          by: ['employeeId', 'userId'],
          where: { ...scoped, createdAt: { gte: since } },
        }),
        // ② 本月消费与计费调用次数
        this.prisma.computeUsageRecord.groupBy({
          by: ['employeeId'],
          where: { ...scoped, createdAt: { gte: monthStart } },
          _sum: { costCNY: true },
          _count: true,
        }),
        // ③ 上次使用时间。刻意取账单而非 ConversationSession.updatedAt：
        //    会话表没有 enterpriseId，按人反查才能限定租户；而账单天生带
        //    enterpriseId，且「开了会话没说话」不该算作用过。
        this.prisma.computeUsageRecord.groupBy({
          by: ['employeeId'],
          where: scoped,
          _max: { createdAt: true },
        }),
        // ④ 有效授权。过期授权不算「已授权人数」—— 它已经不给访问权了
        this.prisma.employeeGrant.findMany({
          where: {
            subscriptionId: { in: subscriptionIds },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { subscriptionId: true, memberId: true, departmentId: true },
        }),
        // ⑤ 能力执行成败。窗口与①同为滚动 30 天，**不是**自然月：
        //   成功率没有对账义务（消费才有），而自然月在月初样本极小 ——
        //   月初 2 号时 6 次执行里失败 2 次就会显示成 67% 的红色，
        //   同一个员工按 30 天算是 87%。样本太小的比例不是信息，是噪声。
        this.executionTallies(enterpriseId, employeeIds, since),
      ]);

    const grantedCounts = await this.expandGrantsToPeople(
      enterpriseId,
      grantRows,
    );
    // 「授权给了几个部门 / 几个人」直接数已查出的授权记录，不再查库。
    // 与 grantedUserCount 是两个问题：那个答「覆盖到多少人」，
    // 这个答「这些人是怎么覆盖到的」—— 收回方式取决于后者。
    const grantShape = new Map<string, { departments: number; members: number }>();
    for (const row of grantRows) {
      const shape = grantShape.get(row.subscriptionId) ?? { departments: 0, members: 0 };
      if (row.departmentId) shape.departments += 1;
      if (row.memberId) shape.members += 1;
      grantShape.set(row.subscriptionId, shape);
    }

    const activeUsers = new Map<string, Set<string>>();
    for (const row of activeRows) {
      // userId 为空 = 系统内部调用（或成员已离职被 SetNull），不该算作「有人在用」
      if (!row.employeeId || !row.userId) continue;
      const set = activeUsers.get(row.employeeId) ?? new Set<string>();
      set.add(row.userId);
      activeUsers.set(row.employeeId, set);
    }

    const monthByEmployee = new Map(
      monthRows.map((r) => [r.employeeId ?? '', r]),
    );
    const lastUsedByEmployee = new Map(
      lastUsedRows.map((r) => [r.employeeId ?? '', r._max.createdAt]),
    );
    const execByEmployee = new Map(execRows.map((r) => [r.employeeId, r]));

    for (const target of targets) {
      const month = monthByEmployee.get(target.employeeId);
      const exec = execByEmployee.get(target.employeeId);
      result.set(target.subscriptionId, {
        activeUserCount30d: activeUsers.get(target.employeeId)?.size ?? 0,
        grantedUserCount: grantedCounts.get(target.subscriptionId) ?? 0,
        grantedDepartmentCount: grantShape.get(target.subscriptionId)?.departments ?? 0,
        grantedMemberCount: grantShape.get(target.subscriptionId)?.members ?? 0,
        lastUsedAt:
          lastUsedByEmployee.get(target.employeeId)?.toISOString() ?? null,
        monthCostCNY: (month?._sum.costCNY ?? new Decimal(0)).toFixed(2),
        monthCallCount: month?._count ?? 0,
        executionCount30d: exec?.total ?? 0,
        successRate30d:
          exec && exec.total > 0
            ? Math.round((exec.success / exec.total) * 100)
            : null,
      });
    }

    return result;
  }

  /**
   * 把授权记录换算成人数：部门授权展开成部门在册人数，再与直接授权去重。
   *
   * 去重是必须的 —— 一个人既被直接授权、又在被授权的部门里，
   * 算两次就会出现「已授权 9 人」而企业只有 8 个人。
   */
  private async expandGrantsToPeople(
    enterpriseId: string,
    grants: Array<{
      subscriptionId: string;
      memberId: string | null;
      departmentId: string | null;
    }>,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (grants.length === 0) return counts;

    const departmentIds = [
      ...new Set(
        grants
          .map((g) => g.departmentId)
          .filter((id): id is string => id !== null),
      ),
    ];

    // 只查被授权到的部门的成员，不是全企业成员表
    const membersByDepartment = new Map<string, string[]>();
    if (departmentIds.length > 0) {
      const members = await this.prisma.enterpriseMember.findMany({
        where: { enterpriseId, departmentId: { in: departmentIds } },
        select: { id: true, departmentId: true },
      });
      for (const m of members) {
        if (!m.departmentId) continue;
        const list = membersByDepartment.get(m.departmentId) ?? [];
        list.push(m.id);
        membersByDepartment.set(m.departmentId, list);
      }
    }

    const peopleBySubscription = new Map<string, Set<string>>();
    for (const grant of grants) {
      const set =
        peopleBySubscription.get(grant.subscriptionId) ?? new Set<string>();
      if (grant.memberId) set.add(grant.memberId);
      if (grant.departmentId) {
        for (const id of membersByDepartment.get(grant.departmentId) ?? []) {
          set.add(id);
        }
      }
      peopleBySubscription.set(grant.subscriptionId, set);
    }

    for (const [subscriptionId, people] of peopleBySubscription) {
      counts.set(subscriptionId, people.size);
    }
    return counts;
  }

  /**
   * 近 30 天能力执行的成败计数（窗口由调用方传入的 `since` 决定）。
   *
   * 必须走原生 SQL：`ToolExecution` 上没有 employeeId（它挂在会话上），
   * Prisma 的 groupBy 不能跨关系分组。按会话 id 先查再聚合会随会话数膨胀，
   * 那就退回 N+1 了。
   *
   * join `enterprise_members` 是租户边界：同一个员工模板会被多家企业雇佣，
   * 不限定成员归属就会把别家的成功率算进来。
   */
  private async executionTallies(
    enterpriseId: string,
    employeeIds: string[],
    /** 滚动 30 天。分母（total）要一起回给前端，只给比例是不可读的。 */
    since: Date,
  ): Promise<ExecutionTally[]> {
    if (employeeIds.length === 0) return [];
    return this.prisma.$queryRaw<ExecutionTally[]>`
      SELECT cs."employeeId"                                        AS "employeeId",
             COUNT(*)::int                                          AS total,
             COUNT(*) FILTER (WHERE te.status = 'SUCCESS')::int     AS success
      FROM tool_executions te
      JOIN conversation_sessions cs ON cs.id = te."sessionId"
      JOIN enterprise_members em
        ON em."userId" = cs."userId" AND em."enterpriseId" = ${enterpriseId}
      WHERE cs."employeeId" = ANY(${employeeIds}::text[])
        AND te."createdAt" >= ${since}
      GROUP BY cs."employeeId"
    `;
  }
}

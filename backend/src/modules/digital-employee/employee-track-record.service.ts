import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 一个员工模板的跨企业履历。 */
export interface EmployeeTrackRecord {
  /** 累计能力执行次数（全平台，不分企业） */
  totalExecutions: number;
  /**
   * 成功率（0–100 整数）。
   * 从未执行过时为 null —— 展示成 0% 会把「新员工」诬为「不好用」。
   */
  successRate: number | null;
}

interface Tally {
  employeeId: string;
  total: number;
  success: number;
}

/**
 * 人才市场的「做得怎么样」—— 累计任务量与成功率。
 *
 * 口径是**跨企业累计**，与「已服务企业 N 家」并列：买家问的是
 * 「这个员工在别处跑得好不好」，只看自己企业的数据答不了这个问题。
 *
 * 会议 §6.1 说的「暂不展示」是**渗透率百分比**（分母会暴露平台规模）。
 * 绝对次数与成功率没有分母问题，故可以展示 —— 详见方案 §4.3。
 */
@Injectable()
export class EmployeeTrackRecordService {
  constructor(private readonly prisma: PrismaService) {}

  /** 批量取回若干员工模板的履历。一条 SQL，与员工数无关。 */
  async forEmployees(
    employeeIds: string[],
  ): Promise<Map<string, EmployeeTrackRecord>> {
    const result = new Map<string, EmployeeTrackRecord>();
    if (employeeIds.length === 0) return result;

    // 原生 SQL：ToolExecution 上没有 employeeId（它挂在会话上），
    // Prisma 的 groupBy 不能跨关系分组。
    const rows = await this.prisma.$queryRaw<Tally[]>`
      SELECT cs."employeeId"                                    AS "employeeId",
             COUNT(*)::int                                      AS total,
             COUNT(*) FILTER (WHERE te.status = 'SUCCESS')::int AS success
      FROM tool_executions te
      JOIN conversation_sessions cs ON cs.id = te."sessionId"
      WHERE cs."employeeId" = ANY(${employeeIds}::text[])
      GROUP BY cs."employeeId"
    `;

    for (const row of rows) {
      result.set(row.employeeId, {
        totalExecutions: row.total,
        successRate:
          row.total > 0 ? Math.round((row.success / row.total) * 100) : null,
      });
    }
    return result;
  }

  /** 单个员工模板的履历。没有执行记录时返回零值而非 undefined。 */
  async forEmployee(employeeId: string): Promise<EmployeeTrackRecord> {
    const map = await this.forEmployees([employeeId]);
    return map.get(employeeId) ?? { totalExecutions: 0, successRate: null };
  }
}

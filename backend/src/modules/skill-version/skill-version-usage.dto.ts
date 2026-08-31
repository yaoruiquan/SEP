import { z } from 'zod';

/**
 * 使用记录汇总：三层聚合（总览 + 分员工 + 分用户）。
 *
 * 调用方权限决定可见范围：
 * - 普通员工看到 summary + byEmployee（全企业范围）
 * - 企业管理员额外看到 byMember（具体到人）
 */
export const SkillVersionUsageSummaryDtoSchema = z.object({
  summary: z.object({
    /** 本企业使用这个技能的不同用户数 */
    distinctUserCount: z.number().int().nonnegative(),
    /** 涉及的对话总数（会话维度去重） */
    totalConversations: z.number().int().nonnegative(),
    /** 调用总轮次（ToolExecution 行数） */
    totalRounds: z.number().int().nonnegative(),
  }),
  /** 按员工聚合 —— 普通员工和管理员都能看 */
  byEmployee: z.array(
    z.object({
      employeeId: z.string(),
      employeeName: z.string(),
      rounds: z.number().int().nonnegative(),
    }),
  ),
  /** 按具体用户聚合 —— 仅企业管理员可见 */
  byMember: z
    .array(
      z.object({
        userId: z.string(),
        userName: z.string().nullable(),
        rounds: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});

export type SkillVersionUsageSummaryDto = z.infer<typeof SkillVersionUsageSummaryDtoSchema>;

/** 执行明细：单次调用的输入输出与版本归属，游标分页 */
export const SkillVersionExecutionDetailDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  /** 调用输入 */
  input: z.unknown(),
  /** 调用输出 */
  output: z.unknown().nullable(),
  status: z.enum(['SUCCESS', 'FAILED']),
  errorMessage: z.string().nullable(),
  duration: z.number().int().nullable(),
  /** 本次执行实际用的技能版本 ID */
  skillVersionId: z.string().nullable(),
  /** 版本作用域（PLATFORM / ENTERPRISE），用于前端显示「平台版」或「企业版」标签 */
  versionScope: z.enum(['PLATFORM', 'ENTERPRISE']).nullable(),
  /** 发起调用的用户（仅管理员可见，普通员工看到 null） */
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  createdAt: z.string(),
});

export type SkillVersionExecutionDetailDto = z.infer<typeof SkillVersionExecutionDetailDtoSchema>;

export const SkillVersionExecutionListDtoSchema = z.object({
  items: z.array(SkillVersionExecutionDetailDtoSchema),
  /** 游标分页：下一页的游标（ISO 时间戳），没有更多时为 null */
  nextCursor: z.string().nullable(),
});

export type SkillVersionExecutionListDto = z.infer<typeof SkillVersionExecutionListDtoSchema>;

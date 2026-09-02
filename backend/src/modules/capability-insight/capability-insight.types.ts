import { z } from 'zod';

/**
 * 模型产出的单条建议。
 *
 * `affectedSnippet` 是可选的：模型未必能准确定位到正文片段，
 * 强制要求会让它编一段出来 —— 编出来的片段比没有片段更糟，
 * 管理员照着改会改错地方。
 */
export const InsightFindingSchema = z.object({
  /** 观察到的现象（「3 位成员都在提示词里补了行业术语表」） */
  phenomenon: z.string().min(1).max(1000),
  /** 具体建议（「把术语表并入技能正文的第 2 节」） */
  suggestion: z.string().min(1).max(2000),
  /** 涉及的正文片段，模型能定位时给出 */
  affectedSnippet: z.string().max(2000).optional(),
  /** 0–1。低置信度的建议界面上要弱化，不能和高置信度并列 */
  confidence: z.number().min(0).max(1),
});

export const InsightOutputSchema = z.object({
  findings: z.array(InsightFindingSchema).max(10),
});

export type InsightFinding = z.infer<typeof InsightFindingSchema>;
export type InsightOutput = z.infer<typeof InsightOutputSchema>;

export const GenerateInsightDtoSchema = z.object({
  scope: z.enum(['MEMBER', 'ALL']),
  /** scope=MEMBER 时必填 */
  memberId: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.scope === 'MEMBER' && !value.memberId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['memberId'],
      message: '针对单个成员分析时必须指定 memberId',
    });
  }
});

export type GenerateInsightDto = z.infer<typeof GenerateInsightDtoSchema>;

export const AdoptInsightDtoSchema = z.object({
  /** 采纳后的完整正文。管理员可在建议基础上再改 —— 模型的建议不是最终答案 */
  content: z.string().min(1, '技能正文不能为空').max(500_000),
  changeSummary: z.string().trim().max(2000).optional(),
});

export type AdoptInsightDto = z.infer<typeof AdoptInsightDtoSchema>;

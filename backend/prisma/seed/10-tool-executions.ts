/**
 * 10-tool-executions.ts — 能力执行记录
 *
 * 为什么要单独一步：`tool_executions` 一直是空表，于是
 * 「我的硅基员工」卡片上的成功率、人才市场详情页的「累计任务量」
 * 只能显示破折号 —— 页面框架在、结果不在，等于没做完（方案 §0 原则 3）。
 *
 * 这里不造假数据源：执行记录挂在**已经存在的会话**上，能力取自该员工
 * **真实绑定**的能力，因此聚合出来的数字和线上口径完全同源，
 * 只是把「历史」补齐了。
 */
import { PrismaClient } from '@prisma/client';

/** 每个会话派生的执行条数上限 —— 一次对话通常触发 1~4 次能力调用 */
const MAX_EXECUTIONS_PER_SESSION = 4;
/** 成功率基线。留一成失败，页面上的成功率才不是恒等的 100% */
const FAILURE_RATE = 0.08;
/** createMany 分批大小，避免单条语句参数过多 */
const CHUNK = 500;

const FAILURE_REASONS = [
  '上游接口超时（30s）',
  '返回内容未通过 JSON 校验',
  '目标系统登录态已失效',
  '参数缺少必填字段：orderId',
];

const INPUT_SAMPLES = [
  { intent: '生成商品详情文案', locale: 'zh-CN' },
  { intent: '汇总本周销售数据', range: 'last_7_days' },
  { intent: '批量导出客户清单', format: 'xlsx' },
  { intent: '整理会议纪要', source: 'transcript' },
  { intent: '核对对账差异', scope: 'monthly' },
];

const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)];

/** 在会话时间之后的几分钟内落点 —— 执行不可能早于会话 */
const shortlyAfter = (base: Date): Date =>
  new Date(base.getTime() + Math.floor(Math.random() * 15 * 60_000) + 1_000);

export async function seedToolExecutions(prisma: PrismaClient) {
  const existing = await prisma.toolExecution.count();
  if (existing > 0) {
    return { created: 0, skipped: true as const };
  }

  // 员工 → 它绑定的能力。没有绑定能力的员工不可能有执行记录。
  const bindings = await prisma.employeeCapabilityBinding.findMany({
    select: { employeeId: true, capabilityId: true },
  });
  const capsByEmployee = new Map<string, string[]>();
  for (const b of bindings) {
    const list = capsByEmployee.get(b.employeeId) ?? [];
    list.push(b.capabilityId);
    capsByEmployee.set(b.employeeId, list);
  }
  if (capsByEmployee.size === 0) {
    return { created: 0, skipped: false as const };
  }

  const sessions = await prisma.conversationSession.findMany({
    select: { id: true, employeeId: true, userId: true, createdAt: true },
  });

  const rows = sessions.flatMap((session) => {
    const caps = capsByEmployee.get(session.employeeId);
    if (!caps?.length) return [];

    const count = Math.floor(Math.random() * MAX_EXECUTIONS_PER_SESSION) + 1;
    return Array.from({ length: count }, () => {
      const failed = Math.random() < FAILURE_RATE;
      return {
        sessionId: session.id,
        capabilityId: pick(caps),
        userId: session.userId,
        input: pick(INPUT_SAMPLES),
        output: failed ? undefined : { ok: true, summary: '已完成' },
        duration: Math.floor(Math.random() * 12_000) + 800,
        tokensUsed: Math.floor(Math.random() * 2_400) + 200,
        status: failed ? ('FAILED' as const) : ('SUCCESS' as const),
        errorMessage: failed ? pick(FAILURE_REASONS) : undefined,
        createdAt: shortlyAfter(session.createdAt),
      };
    });
  });

  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.toolExecution.createMany({ data: rows.slice(i, i + CHUNK) });
  }

  return { created: rows.length, skipped: false as const };
}

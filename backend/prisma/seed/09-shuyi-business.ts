/**
 * 常州数易 —— 业务数据：钱包流水、雇佣关系、授权、30 天用量。
 *
 * 为什么不复用 03-demo-usage / 07-dashboard-analytics：那两个脚本把
 * `demo-ent-acme` 和三个 acme 邮箱写死在查询里，且用 createMany 无唯一键，
 * 每跑一次就往库里再堆一份 30 天数据（不幂等）。这里自带幂等闸门。
 *
 * 三本账各有其用，必须同时写，缺一页就空：
 *   ComputeUsageRecord  → 算力余额页（compute.service.getStats）
 *   ComputeTransaction  → 工作台 Dashboard / 用量分析（读 metadata 里的 token）
 *   WalletTransaction   → 企业钱包页
 */
import { PrismaClient, Prisma } from '@prisma/client';
import type { SeededShuyi } from './08-shuyi-accounts';

/** 确定性随机：重新清库后再跑 seed，演示数字保持一致。 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 两笔充值。演示口径：先备一年预算，中途追加一次。 */
const DEPOSITS = [
  { amount: 80000, daysAgo: 40, description: '年度算力预算充值' },
  { amount: 30000, daysAgo: 12, description: '追加充值' },
];

/**
 * 雇佣计划：员工模板名 → 授权给谁。
 *
 * 授权用部门级为主（企业里的常态是"技术部都能用"），个别岗位用成员级，
 * 这样「授权管理」页两种粒度都有样本。
 * 企业管理员（刘凌）由履约逻辑自动获得全部授权，无需在此列出。
 */
const SUBSCRIPTION_PLAN: Array<{
  employee: string;
  departments?: string[];
  members?: string[];
}> = [
  { employee: '全栈架构师', departments: ['技术部'] },
  { employee: '前端工程师', departments: ['技术部'] },
  { employee: '后端工程师', departments: ['技术部'] },
  { employee: '代码审查专家', departments: ['技术部'] },
  { employee: '测试自动化工程师', departments: ['技术部'] },
  { employee: '产品经理', departments: ['产品部'] },
  { employee: 'UI 设计师', departments: ['产品部'] },
  { employee: '项目经理', departments: ['产品部', '技术部'] },
  { employee: 'SEO 优化专家', departments: ['市场部'] },
  { employee: '多平台内容分发', departments: ['市场部'] },
  { employee: '会议纪要专家', departments: ['技术部', '产品部', '市场部'] },
  { employee: '文档生成专家', members: ['hurui@shuyi.local'] },
  { employee: '财务分析师', members: ['liulingfang@shuyi.local'] },
  { employee: '招聘专家', members: [] },
];

/** 模型分布与美元单价（$/1M tokens），用于生成可复核的账单。 */
const MODEL_MIX = [
  { modelId: 'gpt-4o-mini', weight: 0.5, input: 0.15, output: 0.6 },
  { modelId: 'deepseek-chat', weight: 0.25, input: 0.27, output: 1.1 },
  { modelId: 'gpt-4o', weight: 0.15, input: 2.5, output: 10 },
  { modelId: 'claude-3-5-sonnet-20241022', weight: 0.1, input: 3, output: 15 },
];

const USD_TO_CNY = 7.2;
/** 赠送算力：年费的 10%，取整到 10 元。员工模板未配 includedComputeCNY 时用它。 */
const giftFor = (annualCNY: number) => Math.round((annualCNY * 0.1) / 10) * 10;

function pickModel(rnd: () => number) {
  const r = rnd();
  let acc = 0;
  for (const m of MODEL_MIX) {
    acc += m.weight;
    if (r <= acc) return m;
  }
  return MODEL_MIX[0];
}

export interface ShuyiBusinessResult {
  subscriptionCount: number;
  grantCount: number;
  /** 本次新建的 Message 条数（模型分布面板的数据源） */
  messageCount: number;
  sessionCount: number;
  usageRecordCount: number;
  walletBalanceCNY: number;
  skippedUsage: boolean;
}

/**
 * 清掉本租户的用量三本账，供 `--refresh-usage` 重新生成 ——
 * 演示前重跑一次，30 天趋势就以「今天」收尾，而不是停在上次 seed 的日期。
 *
 * 删除范围严格限定在本企业与本企业成员：会话按 userId 过滤（这 5 个账号
 * 只属于这家企业），流水按本企业的 computeAccount 过滤。
 */
export async function resetShuyiUsage(
  prisma: PrismaClient,
  accounts: SeededShuyi,
): Promise<{ usageRecords: number; transactions: number; sessions: number }> {
  const enterpriseId = accounts.enterprise.id;
  const userIds = [...accounts.members.values()].map((m) => m.userId);

  const usage = await prisma.computeUsageRecord.deleteMany({
    where: { enterpriseId },
  });

  const account = await prisma.computeAccount.findUnique({
    where: { enterpriseId },
    select: { id: true },
  });
  const tx = account
    ? await prisma.computeTransaction.deleteMany({
        where: { accountId: account.id, type: 'CONSUME' },
      })
    : { count: 0 };

  const sessions = await prisma.conversationSession.deleteMany({
    where: { userId: { in: userIds } },
  });

  await prisma.subscriptionCredit.updateMany({
    where: { enterpriseId },
    data: { usedCNY: new Prisma.Decimal(0) },
  });

  return {
    usageRecords: usage.count,
    transactions: tx.count,
    sessions: sessions.count,
  };
}

export async function seedShuyiBusiness(
  prisma: PrismaClient,
  accounts: SeededShuyi,
): Promise<ShuyiBusinessResult> {
  const enterpriseId = accounts.enterprise.id;

  const wallet = await prisma.enterpriseWallet.findUniqueOrThrow({
    where: { enterpriseId },
  });
  const computeAccount = await prisma.computeAccount.findUniqueOrThrow({
    where: { enterpriseId },
  });

  // ── 1. 雇佣关系 ─────────────────────────────────────────────────────────
  // 镜像 SubscriptionFulfillmentService.fulfill()：
  // Subscription + 管理员授权 + SubscriptionCredit 三件套，缺一个页面就报错。
  let subscriptionCount = 0;
  let grantCount = 0;
  let subscriptionSpendCNY = 0;
  /** memberId → 该成员可用的雇佣关系 */
  const reachable = new Map<
    string,
    Array<{ subscriptionId: string; employeeId: string; creditId: string }>
  >();
  const addReach = (
    memberId: string,
    row: { subscriptionId: string; employeeId: string; creditId: string },
  ) => {
    const list = reachable.get(memberId) ?? [];
    if (!list.some((r) => r.subscriptionId === row.subscriptionId)) {
      list.push(row);
    }
    reachable.set(memberId, list);
  };

  const missingEmployees: string[] = [];

  for (const plan of SUBSCRIPTION_PLAN) {
    // 按 (createdAt, id) 取最早那条：线上目录里「UI 设计师」「产品经理」
    // 「财务分析师」各有两条同名 APPROVED 记录（后一批年费 5~7 万、带
    // includedComputeCNY）。不定序就会随机挑中高价那条，钱包数字每次不同。
    const employee = await prisma.digitalEmployee.findFirst({
      where: { name: plan.employee, status: 'APPROVED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        version: true,
        annualPriceCNY: true,
        includedComputeCNY: true,
      },
    });

    if (!employee) {
      missingEmployees.push(plan.employee);
      continue;
    }

    const annual = Number(employee.annualPriceCNY ?? 0);
    const grantedCNY =
      employee.includedComputeCNY !== null
        ? Number(employee.includedComputeCNY)
        : giftFor(annual);

    // @@unique([enterpriseId, employeeId]) —— 一企业一员工只雇一次
    const subscription = await prisma.subscription.upsert({
      where: { enterpriseId_employeeId: { enterpriseId, employeeId: employee.id } },
      update: { status: 'ACTIVE' },
      create: {
        enterpriseId,
        employeeId: employee.id,
        status: 'ACTIVE',
        templateVersion: employee.version,
        name: employee.name,
      },
    });
    subscriptionCount += 1;
    subscriptionSpendCNY += annual;

    const credit = await prisma.subscriptionCredit.upsert({
      where: { subscriptionId: subscription.id },
      update: {},
      create: {
        subscriptionId: subscription.id,
        enterpriseId,
        employeeId: employee.id,
        grantedCNY: new Prisma.Decimal(grantedCNY),
        status: 'ACTIVE',
        sourceType: 'subscription',
      },
    });

    // 授权：EmployeeGrant 的唯一性由两个部分索引表达（见 schema 注释），
    // Prisma 无法 upsert，只能查后建。
    const ensureGrant = async (target: {
      memberId?: string;
      departmentId?: string;
    }) => {
      const found = await prisma.employeeGrant.findFirst({
        where: { subscriptionId: subscription.id, ...target },
        select: { id: true },
      });
      if (found) return;
      await prisma.employeeGrant.create({
        data: { subscriptionId: subscription.id, ...target },
      });
      grantCount += 1;
    };

    // 购买方（企业管理员）默认拿到使用权 —— 与 ensureAdminGrant 一致
    await ensureGrant({ memberId: accounts.adminMemberId });
    addReach(accounts.adminMemberId, {
      subscriptionId: subscription.id,
      employeeId: employee.id,
      creditId: credit.id,
    });

    for (const deptName of plan.departments ?? []) {
      const departmentId = accounts.departments.get(deptName);
      if (!departmentId) throw new Error(`授权目标部门「${deptName}」不存在`);
      await ensureGrant({ departmentId });

      // 部门授权覆盖该部门直属成员 + 其子部门成员
      const deptMembers = await prisma.enterpriseMember.findMany({
        where: {
          enterpriseId,
          department: { OR: [{ id: departmentId }, { parentId: departmentId }] },
        },
        select: { id: true },
      });
      for (const m of deptMembers) {
        addReach(m.id, {
          subscriptionId: subscription.id,
          employeeId: employee.id,
          creditId: credit.id,
        });
      }
    }

    for (const email of plan.members ?? []) {
      const member = accounts.members.get(email);
      if (!member) throw new Error(`授权目标成员「${email}」不存在`);
      await ensureGrant({ memberId: member.id });
      addReach(member.id, {
        subscriptionId: subscription.id,
        employeeId: employee.id,
        creditId: credit.id,
      });
    }
  }

  if (missingEmployees.length > 0) {
    console.warn(
      `⚠️  以下员工模板未上架，已跳过雇佣：${missingEmployees.join('、')}`,
    );
  }

  // ── 2. 钱包：两笔充值 + 每个雇佣一笔扣款 ────────────────────────────────
  // 幂等闸门：已有流水就整段跳过，否则重跑会把余额越算越低。
  const existingWalletTx = await prisma.walletTransaction.count({
    where: { walletId: wallet.id },
  });

  let balance = new Prisma.Decimal(0);
  if (existingWalletTx === 0) {
    const rows: Prisma.WalletTransactionCreateManyInput[] = [];
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    for (const d of DEPOSITS) {
      const before = balance;
      balance = balance.add(d.amount);
      rows.push({
        walletId: wallet.id,
        type: 'DEPOSIT',
        amount: new Prisma.Decimal(d.amount),
        balanceBefore: before,
        balanceAfter: balance,
        paymentMethod: 'alipay',
        description: d.description,
        createdAt: new Date(now - d.daysAgo * day),
      });
    }

    if (subscriptionSpendCNY > 0) {
      const before = balance;
      balance = balance.sub(subscriptionSpendCNY);
      rows.push({
        walletId: wallet.id,
        type: 'CONSUME',
        amount: new Prisma.Decimal(-subscriptionSpendCNY),
        balanceBefore: before,
        balanceAfter: balance,
        relatedType: 'subscription',
        description: `雇佣 ${subscriptionCount} 名硅基员工（年费合计）`,
        createdAt: new Date(now - 38 * day),
      });
    }

    await prisma.walletTransaction.createMany({ data: rows });
    await prisma.enterpriseWallet.update({
      where: { id: wallet.id },
      data: {
        balance,
        totalDeposit: new Prisma.Decimal(
          DEPOSITS.reduce((s, d) => s + d.amount, 0),
        ),
        totalConsume: new Prisma.Decimal(subscriptionSpendCNY),
        version: { increment: 1 },
      },
    });
  } else {
    balance = wallet.balance;
  }

  // ── 3. 30 天用量：会话 + 两本消费账 ─────────────────────────────────────
  const existingUsage = await prisma.computeUsageRecord.count({
    where: { enterpriseId },
  });
  const bail = async (): Promise<ShuyiBusinessResult> => ({
    subscriptionCount,
    grantCount,
    // 用量已存在时仍要补消息：会话早已建好、账单也在，
    // 缺的只是 Message 这一路（模型分布面板唯一的数据源）。
    messageCount: await ensureShuyiMessages(prisma, accounts),
    sessionCount: 0,
    usageRecordCount: 0,
    walletBalanceCNY: Number(balance),
    skippedUsage: true,
  });
  if (existingUsage > 0) return bail();

  const userIdByMemberId = new Map(
    [...accounts.members.values()].map((m) => [m.id, m.userId]),
  );
  const actors = [...reachable.entries()].filter(
    ([memberId, subs]) => subs.length > 0 && userIdByMemberId.has(memberId),
  );
  if (actors.length === 0) return bail();

  const rnd = mulberry32(20260902);
  const usedByCredit = new Map<string, number>();
  const drafts: Array<{
    userId: string;
    memberId: string;
    subscriptionId: string;
    employeeId: string;
    creditId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    inputPrice: number;
    outputPrice: number;
    costCNY: number;
    createdAt: Date;
    title: string;
  }> = [];

  const now = new Date();
  for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
    const base = new Date(now);
    base.setDate(base.getDate() - dayOffset);
    const weekend = base.getDay() === 0 || base.getDay() === 6;
    const perDay = weekend ? 2 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 7);

    for (let i = 0; i < perDay; i += 1) {
      const [memberId, subs] = actors[Math.floor(rnd() * actors.length)];
      const target = subs[Math.floor(rnd() * subs.length)];
      const model = pickModel(rnd);
      // 上下文按真实 agent 用量取值：带知识库检索的一轮对话
      // 输入常在万级，输出千级。取小了账单会失真到不像生产数据。
      const inputTokens = 2000 + Math.floor(rnd() * 18000);
      const outputTokens = 400 + Math.floor(rnd() * 2100);
      const costCNY =
        ((inputTokens / 1e6) * model.input + (outputTokens / 1e6) * model.output) *
        USD_TO_CNY;

      const at = new Date(base);
      at.setHours(9 + Math.floor(rnd() * 10), Math.floor(rnd() * 60), 0, 0);

      drafts.push({
        userId: userIdByMemberId.get(memberId)!,
        memberId,
        subscriptionId: target.subscriptionId,
        employeeId: target.employeeId,
        creditId: target.creditId,
        modelId: model.modelId,
        inputTokens,
        outputTokens,
        inputPrice: model.input,
        outputPrice: model.output,
        costCNY,
        createdAt: at,
        title: `工作对话 ${at.getMonth() + 1}/${at.getDate()} #${i + 1}`,
      });
    }
  }

  drafts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // 逐条 create 而非 createMany：账单要按 sessionId 关联会话，
  // 而 createMany 不回传 id，事后按时间反查会把历史会话一起捞进来。
  const sessionIds: string[] = [];
  for (const d of drafts) {
    const session = await prisma.conversationSession.create({
      data: {
        userId: d.userId,
        employeeId: d.employeeId,
        title: d.title,
        modelId: d.modelId,
        createdAt: d.createdAt,
        updatedAt: d.createdAt,
      },
      select: { id: true },
    });
    sessionIds.push(session.id);
  }

  const usageRows: Prisma.ComputeUsageRecordCreateManyInput[] = [];
  const computeTxRows: Prisma.ComputeTransactionCreateManyInput[] = [];

  drafts.forEach((d, index) => {
    const sessionId = sessionIds[index];
    const cost = new Prisma.Decimal(d.costCNY.toFixed(6));

    // 统一账本：这批消费全部由订阅赠送额度承担，
    // 故 creditPaidCNY == costCNY，恒等式 credit+wallet+unpaid==cost 成立。
    usageRows.push({
      enterpriseId,
      subscriptionId: d.subscriptionId,
      creditId: d.creditId,
      employeeId: d.employeeId,
      userId: d.userId,
      sessionId,
      messageId: `seed-msg-${index}`,
      modelId: d.modelId,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      inputPriceUsdPerMillion: new Prisma.Decimal(d.inputPrice),
      outputPriceUsdPerMillion: new Prisma.Decimal(d.outputPrice),
      usdToCnyRate: new Prisma.Decimal(USD_TO_CNY),
      costCNY: cost,
      creditPaidCNY: cost,
      walletPaidCNY: new Prisma.Decimal(0),
      unpaidCNY: new Prisma.Decimal(0),
      idempotencyKey: `${sessionId}:seed-msg-${index}`,
      createdAt: d.createdAt,
    });

    // Dashboard 与用量分析读的是这本账，metadata 的 key 名必须与
    // enterprise.service 的取值路径一致（inputTokens / outputTokens / memberId）。
    computeTxRows.push({
      accountId: computeAccount.id,
      type: 'CONSUME',
      amount: -Number(cost),
      sessionId,
      tokens: d.inputTokens + d.outputTokens,
      description: `对话消耗（${d.title}）`,
      metadata: {
        enterpriseId,
        memberId: d.memberId,
        subscriptionId: d.subscriptionId,
        model: d.modelId,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
      },
      createdAt: d.createdAt,
    });

    usedByCredit.set(d.creditId, (usedByCredit.get(d.creditId) ?? 0) + d.costCNY);
  });

  // 充值也写进 ComputeTransaction —— 钱包页读 WalletTransaction，
  // 而账单与套餐页读的是这本，两边都要有才不空。
  for (const d of DEPOSITS) {
    computeTxRows.push({
      accountId: computeAccount.id,
      type: 'RECHARGE',
      amount: d.amount,
      description: d.description,
      createdAt: new Date(Date.now() - d.daysAgo * 24 * 60 * 60 * 1000),
    });
  }

  await prisma.computeUsageRecord.createMany({
    data: usageRows,
    skipDuplicates: true,
  });
  await prisma.computeTransaction.createMany({ data: computeTxRows });

  // 赠送额度的已用金额：不更新的话「剩余额度」永远等于赠送总额，演示时一眼假。
  for (const [creditId, used] of usedByCredit) {
    await prisma.subscriptionCredit.update({
      where: { id: creditId },
      data: { usedCNY: new Prisma.Decimal(used.toFixed(6)) },
    });
  }

  const messageCount = await ensureShuyiMessages(prisma, accounts);

  return {
    subscriptionCount,
    grantCount,
    messageCount,
    sessionCount: sessionIds.length,
    usageRecordCount: usageRows.length,
    walletBalanceCNY: Number(balance),
    skippedUsage: false,
  };
}

/**
 * 补齐 Message —— 模型分布面板（enterprise.service.getModelDistribution）
 * **只**读 Message.role='ASSISTANT' 且 modelId 非空的行，不读账单表。
 * 光有 ConversationSession + ComputeUsageRecord 那一格永远是「暂无模型调用数据」。
 *
 * 模型、token、成本一律从该会话对应的 ComputeUsageRecord 回填，
 * 不重新随机 —— 否则模型分布与算力账单会给出两套互相矛盾的数字。
 *
 * 幂等：只处理「一条消息都没有」的会话。Message 没有唯一约束，
 * 靠这个前置判断防重复，不能靠 skipDuplicates。
 */
export async function ensureShuyiMessages(
  prisma: PrismaClient,
  accounts: SeededShuyi,
): Promise<number> {
  const userIds = [...accounts.members.values()].map((m) => m.userId);

  const sessions = await prisma.conversationSession.findMany({
    where: { userId: { in: userIds }, messages: { none: {} } },
    select: {
      id: true,
      title: true,
      createdAt: true,
      employee: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (sessions.length === 0) return 0;

  const records = await prisma.computeUsageRecord.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    select: {
      sessionId: true,
      modelId: true,
      inputTokens: true,
      outputTokens: true,
      costCNY: true,
    },
  });
  const bySession = new Map(records.map((r) => [r.sessionId!, r]));

  const rows: Prisma.MessageCreateManyInput[] = [];
  for (const session of sessions) {
    const usage = bySession.get(session.id);
    // 没有对应账单的会话跳过：宁可这一条不进统计，
    // 也不要凭空编一个模型名和成本进去。
    if (!usage) continue;

    const employeeName = session.employee?.name ?? '硅基员工';
    rows.push({
      sessionId: session.id,
      role: 'USER',
      content: `（演示数据）${employeeName}，请协助处理本次工作事项。`,
      createdAt: session.createdAt,
    });
    rows.push({
      sessionId: session.id,
      role: 'ASSISTANT',
      content: `（演示数据）已完成本次${employeeName}任务，结论与后续建议见上文要点。`,
      modelId: usage.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost: usage.costCNY,
      createdAt: new Date(session.createdAt.getTime() + 8000),
    });
  }

  if (rows.length === 0) return 0;
  await prisma.message.createMany({ data: rows });
  return rows.length;
}

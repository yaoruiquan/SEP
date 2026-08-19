/**
 * 03-demo-usage.ts — 演示用的消费记录和会话数据
 *
 * 为 Dashboard 生成真实的统计数据：
 * - ComputeTransaction (CONSUME 类型，包含 model/tokens 元数据)
 * - Session + Message (可选，用于展示真实对话)
 */
import { PrismaClient } from '@prisma/client';

// 模拟的模型分布权重
const MODEL_DISTRIBUTION = [
  { model: 'deepseek-chat', weight: 0.45 },
  { model: 'gpt-4o-mini', weight: 0.30 },
  { model: 'claude-3-5-sonnet-20241022', weight: 0.15 },
  { model: 'gpt-4o', weight: 0.10 },
];

// 随机选择模型
function pickModel() {
  const rand = Math.random();
  let cumulative = 0;
  for (const { model, weight } of MODEL_DISTRIBUTION) {
    cumulative += weight;
    if (rand <= cumulative) return model;
  }
  return MODEL_DISTRIBUTION[0].model;
}

// 根据模型生成合理的 token 数量
function generateTokens(model: string) {
  const base = {
    input: Math.floor(Math.random() * 3000 + 500),
    output: Math.floor(Math.random() * 1500 + 200),
  };

  // Claude 系列有 prompt cache
  if (model.includes('claude')) {
    return {
      ...base,
      cacheCreationTokens: Math.random() > 0.7 ? Math.floor(Math.random() * 2000 + 500) : 0,
      cacheReadTokens: Math.random() > 0.5 ? Math.floor(Math.random() * 4000 + 1000) : 0,
    };
  }

  return base;
}

// 根据模型和 tokens 计算成本（人民币，近似）
function calculateCost(model: string, tokens: any): number {
  const rates: Record<string, { input: number; output: number }> = {
    'deepseek-chat': { input: 0.0014, output: 0.0028 }, // 1M tokens CNY
    'gpt-4o-mini': { input: 0.001, output: 0.003 },
    'claude-3-5-sonnet-20241022': { input: 0.02, output: 0.08 },
    'gpt-4o': { input: 0.035, output: 0.105 },
  };

  const rate = rates[model] || rates['deepseek-chat'];
  const inputCost = (tokens.input / 1_000_000) * rate.input;
  const outputCost = (tokens.output / 1_000_000) * rate.output;
  const cacheCost = (tokens.cacheCreationTokens || 0) / 1_000_000 * rate.input * 1.25;

  return inputCost + outputCost + cacheCost;
}

export async function seedDemoUsage(prisma: PrismaClient) {
  // 查找示例科技（Acme）的数据
  const acme = await prisma.enterprise.findUnique({
    where: { id: 'demo-ent-acme' },
    include: {
      members: { include: { user: true } },
      subscriptions: { where: { status: 'ACTIVE' }, take: 3 }, // 取前3个订阅
      computeAccount: true,
    },
  });

  if (!acme || !acme.computeAccount) {
    console.warn('⚠️  Acme 企业数据不完整，跳过 demo-usage seed');
    return { transactionCount: 0, sessionCount: 0 };
  }

  // 确保有订阅数据：如果没有订阅，创建一些
  let subscriptions = acme.subscriptions;
  if (subscriptions.length === 0) {
    console.log('  Creating demo subscriptions for Acme...');
    const approvedEmployees = await prisma.digitalEmployee.findMany({
      where: { status: 'APPROVED' },
      take: 3,
    });

    for (const employee of approvedEmployees) {
      await prisma.subscription.create({
        data: {
          enterpriseId: acme.id,
          employeeId: employee.id,
          status: 'ACTIVE',
          templateVersion: employee.version,
        },
      });
    }

    // 重新获取订阅
    subscriptions = await prisma.subscription.findMany({
      where: { enterpriseId: acme.id, status: 'ACTIVE' },
    });
  }

  const members = acme.members.slice(0, 3); // 取前3个成员

  // 生成最近 30 天的消费记录
  const now = new Date();
  const transactions: any[] = [];

  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const date = new Date(now);
    date.setDate(date.getDate() - dayOffset);
    date.setHours(9, 0, 0, 0); // 统一设为早上9点

    // 每天生成 2-4 条消费记录（减少数据量）
    const countForDay = Math.floor(Math.random() * 3) + 2;

    for (let i = 0; i < countForDay; i++) {
      const member = members[Math.floor(Math.random() * members.length)];
      const subscription = subscriptions[Math.floor(Math.random() * subscriptions.length)];
      const model = pickModel();
      const tokens = generateTokens(model);
      const cost = calculateCost(model, tokens);

      // 时间加上随机的小时偏移（9:00 - 18:00 工作时间）
      const timestamp = new Date(date);
      timestamp.setHours(9 + Math.floor(Math.random() * 9));
      timestamp.setMinutes(Math.floor(Math.random() * 60));

      const metadata: Record<string, any> = {
        enterpriseId: acme.id,
        memberId: member.id,
        subscriptionId: subscription.id,
        model,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
      };

      // 只在有值时才添加缓存字段
      if (tokens.cacheCreationTokens !== undefined && tokens.cacheCreationTokens > 0) {
        metadata.cacheCreationTokens = tokens.cacheCreationTokens;
      }
      if (tokens.cacheReadTokens !== undefined && tokens.cacheReadTokens > 0) {
        metadata.cacheReadTokens = tokens.cacheReadTokens;
      }

      transactions.push({
        accountId: acme.computeAccount.id,
        type: 'CONSUME',
        amount: -cost, // 消费是负数
        description: `使用 ${subscription.name || subscription.employee?.name}`,
        metadata,
        createdAt: timestamp,
      });
    }
  }

  // 批量插入
  await prisma.computeTransaction.createMany({
    data: transactions,
    skipDuplicates: true,
  });

  return {
    transactionCount: transactions.length,
    sessionCount: 0, // Session 暂不生成，Dashboard 目前只依赖 Transaction
  };
}

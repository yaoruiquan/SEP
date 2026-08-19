import { PrismaClient } from '@prisma/client';
import { subDays, subHours, startOfDay } from 'date-fns';

const prisma = new PrismaClient();

/**
 * 为 Dashboard 生成模拟的算力消耗和对话数据
 * 模拟最近 30 天的趋势数据，用于展示图表
 */
export async function seedDashboardAnalytics() {
  console.log('📊 Seeding dashboard analytics data...');

  // 获取演示企业
  const acmeEnterprise = await prisma.enterprise.findFirst({
    where: { id: 'demo-ent-acme' },
  });

  if (!acmeEnterprise) {
    console.log('⚠️  Demo enterprise not found, skipping dashboard seed');
    return;
  }

  // 获取演示用户
  const users = await prisma.user.findMany({
    where: {
      email: { in: ['boss@acme.local', 'dev@acme.local', 'staff@acme.local'] },
    },
  });

  if (users.length === 0) {
    console.log('⚠️  Demo users not found, skipping dashboard seed');
    return;
  }

  // 获取演示订阅
  const subscriptions = await prisma.subscription.findMany({
    where: { enterpriseId: acmeEnterprise.id, status: 'ACTIVE' },
    take: 3,
  });

  if (subscriptions.length === 0) {
    console.log('⚠️  No active subscriptions found, skipping dashboard seed');
    return;
  }

  const now = new Date();
  const thirtyDaysAgo = subDays(startOfDay(now), 30);

  // 生成最近 30 天的对话会话（模拟使用趋势）
  console.log('  Creating conversation sessions...');
  const sessions: any[] = [];

  for (let day = 0; day < 30; day++) {
    const baseDate = subDays(now, 29 - day);

    // 每天的会话数量：工作日多，周末少；早9晚6有高峰
    const isWeekend = baseDate.getDay() === 0 || baseDate.getDay() === 6;
    const dailySessionCount = isWeekend ? 3 + Math.floor(Math.random() * 5) : 8 + Math.floor(Math.random() * 12);

    for (let i = 0; i < dailySessionCount; i++) {
      // 模拟工作时间分布（9:00-18:00 高峰）
      const hour = 9 + Math.floor(Math.random() * 10); // 9-18点
      const minute = Math.floor(Math.random() * 60);
      const sessionDate = new Date(baseDate);
      sessionDate.setHours(hour, minute, 0, 0);

      const user = users[Math.floor(Math.random() * users.length)];
      const subscription = subscriptions[Math.floor(Math.random() * subscriptions.length)];

      sessions.push({
        userId: user.id,
        employeeId: subscription.employeeId,
        title: `工作对话 #${day * 20 + i + 1}`,
        createdAt: sessionDate,
        updatedAt: sessionDate,
      });
    }
  }

  // 批量创建会话
  await prisma.conversationSession.createMany({
    data: sessions,
    skipDuplicates: true,
  });

  console.log(`  ✅ Created ${sessions.length} conversation sessions`);

  // 生成算力消耗记录
  console.log('  Creating compute transactions...');

  const computeAccount = await prisma.computeAccount.findUnique({
    where: { enterpriseId: acmeEnterprise.id },
  });

  if (!computeAccount) {
    console.log('⚠️  Compute account not found, skipping transaction seed');
    return;
  }

  // 为每个已创建的会话生成对应的算力消耗
  const createdSessions = await prisma.conversationSession.findMany({
    where: {
      userId: { in: users.map(u => u.id) },
      createdAt: { gte: thirtyDaysAgo },
    },
    orderBy: { createdAt: 'asc' },
  });

  const transactions: any[] = [];

  for (const session of createdSessions) {
    // 模拟每个会话的token消耗
    const inputTokens = 1000 + Math.floor(Math.random() * 4000);
    const outputTokens = 500 + Math.floor(Math.random() * 2000);
    const totalTokens = inputTokens + outputTokens;

    // 简化计费：¥0.01/1000 tokens
    const amount = (totalTokens / 1000) * 0.01;

    transactions.push({
      accountId: computeAccount.id,
      type: 'CONSUME',
      amount: -amount,
      description: `对话消耗 (${session.title})`,
      sessionId: session.id,
      createdAt: session.createdAt,
      metadata: {
        inputTokens,
        outputTokens,
        model: 'gpt-4o-mini',
        employeeId: session.employeeId,
      },
    });
  }

  await prisma.computeTransaction.createMany({
    data: transactions,
    skipDuplicates: true,
  });

  console.log(`  ✅ Created ${transactions.length} compute transactions`);

  // 添加几次充值记录
  console.log('  Creating recharge records...');
  const recharges = [
    {
      accountId: computeAccount.id,
      type: 'RECHARGE' as const,
      amount: 1000,
      description: '初始充值',
      createdAt: subDays(now, 35),
    },
    {
      accountId: computeAccount.id,
      type: 'RECHARGE' as const,
      amount: 500,
      description: '追加充值',
      createdAt: subDays(now, 15),
    },
  ];

  await prisma.computeTransaction.createMany({
    data: recharges,
    skipDuplicates: true,
  });

  console.log(`  ✅ Created ${recharges.length} recharge records`);
  console.log('✅ Dashboard analytics data seeded successfully\n');
}

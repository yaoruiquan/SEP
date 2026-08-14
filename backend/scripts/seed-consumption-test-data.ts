/**
 * 种子脚本：创建消费测试数据（算力 + 订阅）
 * 用途：演示消费日志功能
 * 运行：npx tsx scripts/seed-consumption-test-data.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始创建消费测试数据...\n');

  // 1. 查找示例科技企业
  const enterprise = await prisma.enterprise.findFirst({
    where: { name: { contains: '示例科技' } },
  });

  if (!enterprise) {
    throw new Error('未找到示例科技企业，请先运行 seed-boss-demo.ts');
  }

  console.log(`✅ 找到企业: ${enterprise.name} (${enterprise.id})`);

  // 2. 查找或创建钱包
  let wallet = await prisma.enterpriseWallet.findUnique({
    where: { enterpriseId: enterprise.id },
  });

  if (!wallet) {
    wallet = await prisma.enterpriseWallet.create({
      data: {
        enterpriseId: enterprise.id,
        balance: 1000000, // 初始余额 100 万分（= 10000 元）
      },
    });
    console.log('✅ 创建企业钱包');
  } else {
    console.log(`✅ 钱包余额: ${wallet.balance}`);
  }

  // 3. 查找员工和成员（通过订阅关系查找）
  const employees = await prisma.digitalEmployee.findMany({
    where: {
      subscriptions: {
        some: { enterpriseId: enterprise.id }
      }
    },
    take: 3,
  });

  const members = await prisma.user.findMany({
    where: {
      memberships: {
        some: { enterpriseId: enterprise.id }
      }
    },
    take: 2,
  });

  if (employees.length === 0) {
    throw new Error('企业没有硅基员工');
  }

  if (members.length === 0) {
    throw new Error('企业没有成员');
  }

  console.log(`✅ 找到 ${employees.length} 个员工, ${members.length} 个成员\n`);

  // 4. 创建对话会话（用于算力消费）
  const sessions = [];
  for (let i = 0; i < 5; i++) {
    const employee = employees[i % employees.length];
    const member = members[i % members.length];

    const session = await prisma.conversationSession.create({
      data: {
        employeeId: employee.id,
        userId: member.id,
        title: `测试对话 ${i + 1} - ${['产品需求分析', '代码审查', '技术咨询', '数据分析', 'Bug 修复'][i]}`,
        modelId: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'gemini-pro', 'deepseek-chat'][i % 5],
      },
    });
    sessions.push(session);
    console.log(`✅ 创建会话: ${session.title}`);
  }

  console.log('');

  // 5. 查找或创建订阅（用于订阅消费）
  const subscriptions = [];
  for (let i = 0; i < employees.length; i++) {
    const employee = employees[i];

    let subscription = await prisma.subscription.findFirst({
      where: {
        enterpriseId: enterprise.id,
        employeeId: employee.id,
        status: 'ACTIVE',
      },
    });

    if (!subscription) {
      subscription = await prisma.subscription.create({
        data: {
          enterpriseId: enterprise.id,
          employeeId: employee.id,
          templateVersion: 'v1.0',
          status: 'ACTIVE',
          startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10天前开始
        },
      });
      console.log(`✅ 创建订阅: ${employee.name}`);
    } else {
      console.log(`✅ 使用现有订阅: ${employee.name}`);
    }

    subscriptions.push(subscription);
  }

  console.log('');

  // 6. 创建算力消费记录
  console.log('📊 创建算力消费记录...');
  const computeAmounts = [
    { amount: -1500, tokens: 15000, desc: '长对话 - 深度需求分析' },
    { amount: -800, tokens: 8000, desc: '中等对话 - 代码审查' },
    { amount: -300, tokens: 3000, desc: '简短咨询' },
    { amount: -2000, tokens: 20000, desc: '复杂分析 - 大量上下文' },
    { amount: -500, tokens: 5000, desc: '普通对话' },
  ];

  let currentBalance = new Prisma.Decimal(wallet.balance.toString());
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const { amount, tokens, desc } = computeAmounts[i];

    // 创建不同时间的消费（最近7天内）
    const daysAgo = i + 1;
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const balanceBefore = currentBalance;
    const balanceAfter = currentBalance.add(amount);
    currentBalance = balanceAfter;

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'CONSUME',
        amount,
        balanceBefore,
        balanceAfter,
        relatedType: 'compute',
        relatedId: session.id,
        description: `对话消费 - ${session.title}`,
        metadata: {
          sessionId: session.id,
          tokenCount: tokens,
          modelName: session.modelId,
          conversationTitle: session.title,
        },
        createdAt,
      },
    });

    console.log(`  ✅ ${daysAgo}天前 - ${desc}: ${amount / 100}元 (${tokens} tokens)`);
  }

  console.log('');

  // 7. 创建订阅消费记录
  console.log('📊 创建订阅消费记录...');
  const subscriptionAmounts = [
    { amount: -9900, cycle: 'MONTHLY', desc: '企业版月订阅' },
    { amount: -4900, cycle: 'MONTHLY', desc: '专业版月订阅' },
    { amount: -2900, cycle: 'MONTHLY', desc: '基础版月订阅' },
  ];

  for (let i = 0; i < subscriptions.length; i++) {
    const subscription = subscriptions[i];
    const { amount, cycle, desc } = subscriptionAmounts[i % subscriptionAmounts.length];

    // 订阅消费在月初
    const daysAgo = 5 + i;
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const employee = employees.find(e => e.id === subscription.employeeId);

    const balanceBefore = currentBalance;
    const balanceAfter = currentBalance.add(amount);
    currentBalance = balanceAfter;

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'CONSUME',
        amount,
        balanceBefore,
        balanceAfter,
        relatedType: 'subscription',
        relatedId: subscription.id,
        description: `订阅费用 - ${employee?.name}`,
        metadata: {
          subscriptionId: subscription.id,
          billingCycle: cycle,
          planName: employee?.name,
        },
        createdAt,
      },
    });

    console.log(`  ✅ ${daysAgo}天前 - ${desc}: ${amount / 100}元`);
  }

  console.log('');

  // 8. 更新钱包余额
  const totalConsume = [...computeAmounts, ...subscriptionAmounts]
    .reduce((sum, item) => sum + item.amount, 0);

  await prisma.enterpriseWallet.update({
    where: { id: wallet.id },
    data: { balance: currentBalance },
  });

  console.log(`✅ 更新钱包余额: 消费 ${Math.abs(totalConsume) / 100} 元`);
  console.log(`   当前余额: ${currentBalance / 100} 元\n`);

  // 9. 统计数据
  const computeCount = await prisma.walletTransaction.count({
    where: { walletId: wallet.id, relatedType: 'compute' },
  });

  const subscriptionCount = await prisma.walletTransaction.count({
    where: { walletId: wallet.id, relatedType: 'subscription' },
  });

  console.log('📈 数据统计:');
  console.log(`   算力消费记录: ${computeCount} 条`);
  console.log(`   订阅消费记录: ${subscriptionCount} 条`);
  console.log(`   总消费记录: ${computeCount + subscriptionCount} 条`);
  console.log('');
  console.log('✨ 测试数据创建完成！');
  console.log('💡 访问 http://localhost:3000/usage 查看效果');
}

main()
  .catch((e) => {
    console.error('❌ 错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

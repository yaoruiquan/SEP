/**
 * 00-cleanup.ts - 清理旧数据，为新的 50 人方案做准备
 *
 * 清理范围：
 * - DigitalEmployee (级联删除 bindings, subscriptions, sessions, orderItems, cartItems)
 * - Capability (级联删除 skillConfig, agentConfig, rpaConfig, aiAppConfig, bindings)
 *
 * 保留：
 * - User (演示账号)
 * - Enterprise (企业)
 * - EnterpriseMember (成员关系)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  console.log('🧹 开始清理旧数据...\n');

  // 统计当前数据
  const beforeCounts = {
    employees: await prisma.digitalEmployee.count(),
    capabilities: await prisma.capability.count(),
    bindings: await prisma.employeeCapabilityBinding.count(),
    subscriptions: await prisma.subscription.count(),
    sessions: await prisma.conversationSession.count(),
    orders: await prisma.order.count(),
    carts: await prisma.cartItem.count(),
  };

  console.log('📊 清理前统计：');
  console.log('  - DigitalEmployee:', beforeCounts.employees);
  console.log('  - Capability:', beforeCounts.capabilities);
  console.log('  - EmployeeCapabilityBinding:', beforeCounts.bindings);
  console.log('  - Subscription:', beforeCounts.subscriptions);
  console.log('  - ConversationSession:', beforeCounts.sessions);
  console.log('  - Order:', beforeCounts.orders);
  console.log('  - CartItem:', beforeCounts.carts);
  console.log('');

  // 1. 删除购物车项（引用 DigitalEmployee）
  console.log('🗑️  删除购物车项...');
  await prisma.cartItem.deleteMany({});

  // 2. 删除订单项（引用 DigitalEmployee）
  console.log('🗑️  删除订单项...');
  await prisma.orderItem.deleteMany({});

  // 3. 删除对话会话（引用 DigitalEmployee）
  console.log('🗑️  删除对话会话...');
  await prisma.conversationSession.deleteMany({});

  // 4. 删除订阅关系（引用 DigitalEmployee）
  console.log('🗑️  删除订阅关系...');
  await prisma.subscription.deleteMany({});

  // 5. 删除订阅申请（引用 DigitalEmployee）
  console.log('🗑️  删除订阅申请...');
  await prisma.subscriptionRequest.deleteMany({});

  // 6. 删除员工套餐关系
  console.log('🗑️  删除员工套餐关系...');
  await prisma.employeePackage.deleteMany({});

  // 7. 删除员工-技能绑定关系
  console.log('🗑️  删除员工-技能绑定关系...');
  await prisma.employeeCapabilityBinding.deleteMany({});

  // 8. 删除数字员工（现在所有外键引用已清理）
  console.log('🗑️  删除数字员工...');
  await prisma.digitalEmployee.deleteMany({});

  // 9. 删除技能配置（级联删除 SkillConfig/AgentConfig/RPAConfig/AIAppConfig）
  console.log('🗑️  删除技能配置...');
  await prisma.capability.deleteMany({});

  // 统计清理后数据
  const afterCounts = {
    employees: await prisma.digitalEmployee.count(),
    capabilities: await prisma.capability.count(),
    bindings: await prisma.employeeCapabilityBinding.count(),
    subscriptions: await prisma.subscription.count(),
    sessions: await prisma.conversationSession.count(),
    orders: await prisma.order.count(),
    carts: await prisma.cartItem.count(),
  };

  console.log('');
  console.log('✅ 清理完成！\n');
  console.log('📊 清理后统计：');
  console.log('  - DigitalEmployee:', afterCounts.employees);
  console.log('  - Capability:', afterCounts.capabilities);
  console.log('  - EmployeeCapabilityBinding:', afterCounts.bindings);
  console.log('  - Subscription:', afterCounts.subscriptions);
  console.log('  - ConversationSession:', afterCounts.sessions);
  console.log('  - Order:', afterCounts.orders);
  console.log('  - CartItem:', afterCounts.carts);
  console.log('');
  console.log('🎉 数据库已准备好接收新的 50 人方案！');
}

cleanup()
  .catch((e) => {
    console.error('❌ 清理失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

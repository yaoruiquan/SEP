/**
 * Boss 演示数据 - 订阅申请审批流程
 *
 * 创建 4 个账号 + 2 个企业 + 3 个数字员工
 * 密码统一: Demo123456
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始创建演示数据...\n');

  // 统一密码
  const password = await bcrypt.hash('Demo123456', 10);

  // ============================================================================
  // 1. 创建用户
  // ============================================================================
  console.log('👤 创建用户...');

  const bossAcme = await prisma.user.upsert({
    where: { email: 'boss@acme.local' },
    update: {},
    create: {
      email: 'boss@acme.local',
      name: 'ACME 企业管理员',
      password,
      role: 'USER',
    },
  });
  console.log('  ✓ boss@acme.local (ACME 企业管理员)');

  const staffAcme = await prisma.user.upsert({
    where: { email: 'staff@acme.local' },
    update: {},
    create: {
      email: 'staff@acme.local',
      name: 'ACME 普通员工',
      password,
      role: 'USER',
    },
  });
  console.log('  ✓ staff@acme.local (ACME 普通员工)');

  const bossGlobex = await prisma.user.upsert({
    where: { email: 'boss@globex.local' },
    update: {},
    create: {
      email: 'boss@globex.local',
      name: 'Globex 企业管理员',
      password,
      role: 'USER',
    },
  });
  console.log('  ✓ boss@globex.local (Globex 企业管理员)');

  const adminSep = await prisma.user.upsert({
    where: { email: 'admin@sep.local' },
    update: {},
    create: {
      email: 'admin@sep.local',
      name: 'SEP 平台运营',
      password,
      role: 'ADMIN',
    },
  });
  console.log('  ✓ admin@sep.local (SEP 平台运营)\n');

  // ============================================================================
  // 2. 创建企业
  // ============================================================================
  console.log('🏢 创建企业...');

  const acmeEnterprise = await prisma.enterprise.upsert({
    where: { id: 'demo-acme' },
    update: {},
    create: {
      id: 'demo-acme',
      name: 'ACME Corporation',
      description: '一家创新型科技公司',
    },
  });
  console.log('  ✓ ACME Corporation');

  const globexEnterprise = await prisma.enterprise.upsert({
    where: { id: 'demo-globex' },
    update: {},
    create: {
      id: 'demo-globex',
      name: 'Globex Industries',
      description: '全球领先的工业制造企业',
    },
  });
  console.log('  ✓ Globex Industries\n');

  // ============================================================================
  // 3. 创建企业成员
  // ============================================================================
  console.log('👥 创建企业成员关系...');

  await prisma.enterpriseMember.upsert({
    where: {
      userId_enterpriseId: {
        userId: bossAcme.id,
        enterpriseId: acmeEnterprise.id,
      },
    },
    update: {},
    create: {
      enterpriseId: acmeEnterprise.id,
      userId: bossAcme.id,
      role: 'ENTERPRISE_ADMIN',
    },
  });
  console.log('  ✓ boss@acme.local → ACME (管理员)');

  await prisma.enterpriseMember.upsert({
    where: {
      userId_enterpriseId: {
        userId: staffAcme.id,
        enterpriseId: acmeEnterprise.id,
      },
    },
    update: {},
    create: {
      enterpriseId: acmeEnterprise.id,
      userId: staffAcme.id,
      role: 'MEMBER',
    },
  });
  console.log('  ✓ staff@acme.local → ACME (普通成员)');

  await prisma.enterpriseMember.upsert({
    where: {
      userId_enterpriseId: {
        userId: bossGlobex.id,
        enterpriseId: globexEnterprise.id,
      },
    },
    update: {},
    create: {
      enterpriseId: globexEnterprise.id,
      userId: bossGlobex.id,
      role: 'ENTERPRISE_ADMIN',
    },
  });
  console.log('  ✓ boss@globex.local → Globex (管理员)\n');

  // ============================================================================
  // 4. 创建部门
  // ============================================================================
  console.log('🏢 创建部门...');

  // ACME Corporation 部门结构
  const acmeTech = await prisma.department.create({
    data: {
      enterpriseId: acmeEnterprise.id,
      name: '技术部',
      sortOrder: 1,
    },
  });
  console.log('  ✓ ACME - 技术部');

  await prisma.department.create({
    data: {
      enterpriseId: acmeEnterprise.id,
      name: '研发组',
      parentId: acmeTech.id,
      sortOrder: 1,
    },
  });
  console.log('  ✓ ACME - 研发组');

  await prisma.department.create({
    data: {
      enterpriseId: acmeEnterprise.id,
      name: '运维组',
      parentId: acmeTech.id,
      sortOrder: 2,
    },
  });
  console.log('  ✓ ACME - 运维组');

  await prisma.department.create({
    data: {
      enterpriseId: acmeEnterprise.id,
      name: '市场部',
      sortOrder: 2,
    },
  });
  console.log('  ✓ ACME - 市场部');

  await prisma.department.create({
    data: {
      enterpriseId: acmeEnterprise.id,
      name: '行政部',
      sortOrder: 3,
    },
  });
  console.log('  ✓ ACME - 行政部');

  // Globex Industries 部门结构
  const globexManufacture = await prisma.department.create({
    data: {
      enterpriseId: globexEnterprise.id,
      name: '制造部',
      sortOrder: 1,
    },
  });
  console.log('  ✓ Globex - 制造部');

  await prisma.department.create({
    data: {
      enterpriseId: globexEnterprise.id,
      name: '生产组',
      parentId: globexManufacture.id,
      sortOrder: 1,
    },
  });
  console.log('  ✓ Globex - 生产组');

  await prisma.department.create({
    data: {
      enterpriseId: globexEnterprise.id,
      name: '销售部',
      sortOrder: 2,
    },
  });
  console.log('  ✓ Globex - 销售部');

  await prisma.department.create({
    data: {
      enterpriseId: globexEnterprise.id,
      name: '财务部',
      sortOrder: 3,
    },
  });
  console.log('  ✓ Globex - 财务部\n');

  // ============================================================================
  // 5. 创建企业钱包并充值
  // ============================================================================
  console.log('💰 创建企业钱包...');

  await prisma.enterpriseWallet.upsert({
    where: { enterpriseId: acmeEnterprise.id },
    update: {},
    create: {
      enterpriseId: acmeEnterprise.id,
      balance: 100000, // 10万元余额
      frozenAmount: 0,
      totalDeposit: 100000,
      totalConsume: 0,
      totalRefund: 0,
      version: 1,
    },
  });
  console.log('  ✓ ACME 钱包: ¥100,000');

  await prisma.enterpriseWallet.upsert({
    where: { enterpriseId: globexEnterprise.id },
    update: {},
    create: {
      enterpriseId: globexEnterprise.id,
      balance: 50000, // 5万元余额
      frozenAmount: 0,
      totalDeposit: 50000,
      totalConsume: 0,
      totalRefund: 0,
      version: 1,
    },
  });
  console.log('  ✓ Globex 钱包: ¥50,000\n');

  // ============================================================================
  // 6. 创建算力配额（P2 计算配额系统）
  // ============================================================================
  console.log('💎 创建算力配额...');

  // ACME 企业配额：FREE + STANDARD
  await prisma.computeQuota.upsert({
    where: { id: 'acme-quota-free' },
    update: {},
    create: {
      id: 'acme-quota-free',
      enterpriseId: acmeEnterprise.id,
      type: 'FREE',
      totalTokens: 100000, // 10 万 tokens 免费配额
      usedTokens: 0,
      priority: 0, // 最高优先级，优先消耗
      expiresAt: null, // 永久有效
      status: 'ACTIVE',
    },
  });
  console.log('  ✓ ACME 免费配额: 100,000 tokens (priority 0)');

  await prisma.computeQuota.upsert({
    where: { id: 'acme-quota-standard' },
    update: {},
    create: {
      id: 'acme-quota-standard',
      enterpriseId: acmeEnterprise.id,
      type: 'STANDARD',
      totalTokens: 1000000, // 100 万 tokens 标准配额
      usedTokens: 0,
      priority: 1, // 次优先级，免费用完后消耗
      expiresAt: null, // 永久有效
      status: 'ACTIVE',
    },
  });
  console.log('  ✓ ACME 标准配额: 1,000,000 tokens (priority 1)');

  // Globex 企业配额：FREE
  await prisma.computeQuota.upsert({
    where: { id: 'globex-quota-free' },
    update: {},
    create: {
      id: 'globex-quota-free',
      enterpriseId: globexEnterprise.id,
      type: 'FREE',
      totalTokens: 50000, // 5 万 tokens 免费配额
      usedTokens: 0,
      priority: 0,
      expiresAt: null,
      status: 'ACTIVE',
    },
  });
  console.log('  ✓ Globex 免费配额: 50,000 tokens (priority 0)\n');

  // ============================================================================
  // 7. 创建数字员工
  // ============================================================================
  console.log('🤖 创建数字员工...');

  const employee1 = await prisma.digitalEmployee.upsert({
    where: { id: 'demo-employee-1' },
    update: {},
    create: {
      id: 'demo-employee-1',
      name: 'AI 客服助手',
      description: '7x24小时在线客服，支持多轮对话和情感分析',
      industry: '客户服务',
      position: '客服专员',
      systemPrompt: '你是一个专业的客服助手，善于理解用户需求并提供贴心服务。',
      status: 'APPROVED',
      annualPriceCNY: 12000, // 年费 12000 元
      avatar: null,
    },
  });
  console.log('  ✓ AI 客服助手 (¥12,000/年)');

  const employee2 = await prisma.digitalEmployee.upsert({
    where: { id: 'demo-employee-2' },
    update: {},
    create: {
      id: 'demo-employee-2',
      name: '数据分析师',
      description: '专业数据分析，生成可视化报表和业务洞察',
      industry: '数据分析',
      position: '数据分析师',
      systemPrompt: '你是一个专业的数据分析师，擅长从数据中发现规律并提供商业建议。',
      status: 'APPROVED',
      annualPriceCNY: 18000, // 年费 18000 元
      avatar: null,
    },
  });
  console.log('  ✓ 数据分析师 (¥18,000/年)');

  const employee3 = await prisma.digitalEmployee.upsert({
    where: { id: 'demo-employee-3' },
    update: {},
    create: {
      id: 'demo-employee-3',
      name: '内容创作专家',
      description: '高质量文案创作，支持多种风格和场景',
      industry: '营销推广',
      position: '内容创作',
      systemPrompt: '你是一个专业的内容创作者，能够根据不同场景创作高质量文案。',
      status: 'APPROVED',
      annualPriceCNY: 15000, // 年费 15000 元
      avatar: null,
    },
  });
  console.log('  ✓ 内容创作专家 (¥15,000/年)\n');

  // ============================================================================
  // 7. 创建示例订阅（为 boss@acme.local 创建一个已有订阅）
  // ============================================================================
  console.log('📋 创建示例订阅...');

  const acmeBossMember = await prisma.enterpriseMember.findUnique({
    where: {
      userId_enterpriseId: {
        userId: bossAcme.id,
        enterpriseId: acmeEnterprise.id,
      },
    },
  });

  // 创建钱包交易记录
  const walletTransaction = await prisma.walletTransaction.create({
    data: {
      type: 'CONSUME',
      amount: 12000,
      balanceBefore: 100000,
      balanceAfter: 88000,
      description: '订阅 AI 客服助手',
      relatedType: 'SUBSCRIPTION',
      wallet: {
        connect: {
          enterpriseId: acmeEnterprise.id,
        },
      },
    },
  });

  const existingSubscription = await prisma.subscription.upsert({
    where: {
      enterpriseId_employeeId: {
        enterpriseId: acmeEnterprise.id,
        employeeId: employee1.id,
      },
    },
    update: {
      status: 'ACTIVE',
      startDate: new Date(),
      walletTransactionId: walletTransaction.id,
    },
    create: {
      enterpriseId: acmeEnterprise.id,
      employeeId: employee1.id,
      status: 'ACTIVE',
      templateVersion: '1.0.0',
      name: 'AI 客服助手',
      startDate: new Date(),
      walletTransactionId: walletTransaction.id,
    },
  });

  // 为管理员创建授权（检查是否已存在）
  const existingGrant = await prisma.employeeGrant.findFirst({
    where: {
      subscriptionId: existingSubscription.id,
      memberId: acmeBossMember!.id,
    },
  });

  if (!existingGrant) {
    await prisma.employeeGrant.create({
      data: {
        subscriptionId: existingSubscription.id,
        memberId: acmeBossMember!.id,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1年后过期
      },
    });
  }

  // 更新钱包余额
  await prisma.enterpriseWallet.update({
    where: { enterpriseId: acmeEnterprise.id },
    data: {
      balance: 88000,
      totalConsume: 12000,
    },
  });

  console.log('  ✓ ACME 已订阅 AI 客服助手（管理员有权限）\n');

  // ============================================================================
  // 9. 三级配额系统（演示数据）
  // ============================================================================
  console.log('🎫 创建三级配额...');

  // 9.1 用户个人配额（碳基员工 - Priority 0）
  await prisma.userQuota.upsert({
    where: {
      userId_enterpriseId: {
        userId: bossAcme.id,
        enterpriseId: enterpriseAcme.id,
      },
    },
    update: {},
    create: {
      userId: bossAcme.id,
      enterpriseId: enterpriseAcme.id,
      totalTokens: 50_000,
      usedTokens: 0,
      status: 'ACTIVE',
      allocatedBy: bossAcme.id,
      notes: '管理员个人配额',
    },
  });
  console.log('  ✓ boss@acme.local 个人配额: 50,000 tokens');

  await prisma.userQuota.upsert({
    where: {
      userId_enterpriseId: {
        userId: staffAcme.id,
        enterpriseId: enterpriseAcme.id,
      },
    },
    update: {},
    create: {
      userId: staffAcme.id,
      enterpriseId: enterpriseAcme.id,
      totalTokens: 30_000,
      usedTokens: 0,
      status: 'ACTIVE',
      allocatedBy: bossAcme.id,
      notes: '普通员工个人配额',
    },
  });
  console.log('  ✓ staff@acme.local 个人配额: 30,000 tokens');

  // 9.2 订阅配额（硅基员工自带 - Priority 1）
  // 为已创建的订阅添加配额
  const acmeSubscriptions = await prisma.subscription.findMany({
    where: { enterpriseId: enterpriseAcme.id },
  });

  for (const sub of acmeSubscriptions) {
    await prisma.subscriptionQuota.upsert({
      where: { subscriptionId: sub.id },
      update: {},
      create: {
        subscriptionId: sub.id,
        enterpriseId: enterpriseAcme.id,
        totalTokens: 100_000,
        usedTokens: 0,
        status: 'ACTIVE',
      },
    });
  }
  console.log(`  ✓ ACME 订阅配额: ${acmeSubscriptions.length} 个订阅 x 100,000 tokens`);

  // 9.3 企业配额池（兜底 - Priority 2）
  await prisma.computeQuota.upsert({
    where: { id: 'demo-quota-acme-standard' },
    update: {},
    create: {
      id: 'demo-quota-acme-standard',
      enterpriseId: enterpriseAcme.id,
      type: 'STANDARD',
      totalTokens: 1_000_000,
      usedTokens: 0,
      priority: 2,
      status: 'ACTIVE',
    },
  });
  console.log('  ✓ ACME 企业池: 1,000,000 tokens (STANDARD)');

  await prisma.computeQuota.upsert({
    where: { id: 'demo-quota-globex-standard' },
    update: {},
    create: {
      id: 'demo-quota-globex-standard',
      enterpriseId: enterpriseGlobex.id,
      type: 'STANDARD',
      totalTokens: 500_000,
      usedTokens: 0,
      priority: 2,
      status: 'ACTIVE',
    },
  });
  console.log('  ✓ Globex 企业池: 500,000 tokens (STANDARD)\n');

  // ============================================================================
  // 完成
  // ============================================================================
  console.log('✅ 演示数据创建完成！\n');
  console.log('📊 数据摘要：');
  console.log('  • 4 个用户（统一密码: Demo123456）');
  console.log('  • 2 个企业（ACME, Globex）');
  console.log('  • 9 个部门（ACME: 5 个，Globex: 4 个）');
  console.log('  • 3 个数字员工（已审批）');
  console.log('  • ACME 钱包余额: ¥88,000');
  console.log('  • Globex 钱包余额: ¥50,000');
  console.log('  • 1 个示例订阅（ACME 订阅了 AI 客服助手）');
  console.log('  • 三级配额系统：');
  console.log('    - 用户配额: boss 50K, staff 30K tokens');
  console.log('    - 订阅配额: 1 个订阅 x 100K tokens');
  console.log('    - 企业池: ACME 1M, Globex 500K tokens\n');
  console.log('🎯 测试账号：');
  console.log('  boss@acme.local      - ACME 企业管理员');
  console.log('  staff@acme.local     - ACME 普通员工');
  console.log('  boss@globex.local    - Globex 企业管理员');
  console.log('  admin@sep.local      - SEP 平台运营\n');
}

main()
  .catch((e) => {
    console.error('❌ 错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

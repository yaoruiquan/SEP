import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // 1. 创建平台管理员
  const platformAdminPassword = await bcrypt.hash('admin123', 10);
  const platformAdmin = await prisma.user.upsert({
    where: { email: 'admin@sep.com' },
    update: {},
    create: {
      email: 'admin@sep.com',
      name: '平台管理员',
      password: platformAdminPassword,
      role: 'ADMIN',
    },
  });
  console.log('✅ Platform admin created:', platformAdmin.email);

  // 2. 创建企业
  let enterprise = await prisma.enterprise.findFirst({
    where: { name: '示例科技有限公司' },
  });
  if (!enterprise) {
    enterprise = await prisma.enterprise.create({
      data: {
        name: '示例科技有限公司',
        description: '一家专注于 AI 和云计算的科技公司',
      },
    });
  }
  console.log('✅ Enterprise created:', enterprise.name);

  // 3. 创建企业算力账户
  let computeAccount = await prisma.computeAccount.findUnique({
    where: { enterpriseId: enterprise.id },
  });
  if (!computeAccount) {
    computeAccount = await prisma.computeAccount.create({
      data: {
        enterpriseId: enterprise.id,
        balance: 100000, // 初始 10 万算力
      },
    });

    // 4. 添加充值记录
    await prisma.computeTransaction.create({
      data: {
        accountId: computeAccount.id,
        type: 'RECHARGE',
        amount: 100000,
        description: '初始充值',
      },
    });
    console.log('✅ Compute account created with 100k balance');
  } else {
    console.log('✅ Compute account already exists');
  }

  // 5. 创建企业管理员用户
  const enterpriseAdminPassword = await bcrypt.hash('admin123', 10);
  const enterpriseAdmin = await prisma.user.upsert({
    where: { email: 'boss@example.com' },
    update: {},
    create: {
      email: 'boss@example.com',
      name: '张总',
      password: enterpriseAdminPassword,
      role: 'USER',
    },
  });

  // 6. 关联用户到企业（管理员角色）
  await prisma.enterpriseMember.upsert({
    where: {
      userId_enterpriseId: {
        userId: enterpriseAdmin.id,
        enterpriseId: enterprise.id,
      },
    },
    update: {},
    create: {
      userId: enterpriseAdmin.id,
      enterpriseId: enterprise.id,
      role: 'ENTERPRISE_ADMIN',
    },
  });
  console.log('✅ Enterprise admin created:', enterpriseAdmin.email);

  // 7. 创建普通员工用户（3个）
  const memberUsers = [];
  for (let i = 1; i <= 3; i++) {
    const password = await bcrypt.hash('user123', 10);
    const user = await prisma.user.upsert({
      where: { email: `user${i}@example.com` },
      update: {},
      create: {
        email: `user${i}@example.com`,
        name: `员工${i}`,
        password,
        role: 'USER',
      },
    });
    memberUsers.push(user);

    await prisma.enterpriseMember.upsert({
      where: {
        userId_enterpriseId: {
          userId: user.id,
          enterpriseId: enterprise.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        enterpriseId: enterprise.id,
        role: 'MEMBER',
      },
    });
  }
  console.log('✅ 3 enterprise members created');

  // 8. 创建数字员工模板
  const employees = [
    {
      name: 'HR 助手小慧',
      description: '专业的人力资源助手，擅长招聘、培训和员工关系管理',
      position: '人力资源',
      industry: 'HR',
      systemPrompt: '你是一位专业的 HR 助手...',
      modelId: 'gpt-4',
      annualPriceCNY: 12000,
    },
    {
      name: '销售顾问小李',
      description: 'CRM 和销售流程专家，帮助提升销售业绩',
      position: '销售',
      industry: 'CRM',
      systemPrompt: '你是一位资深的销售顾问...',
      modelId: 'gpt-4',
      annualPriceCNY: 15000,
    },
    {
      name: '财务分析师小王',
      description: '财务报表分析、成本控制专家',
      position: '财务',
      industry: '财务分析',
      systemPrompt: '你是一位专业的财务分析师...',
      modelId: 'gpt-4',
      annualPriceCNY: 18000,
    },
  ];

  const createdEmployees = [];
  for (const emp of employees) {
    let employee = await prisma.digitalEmployee.findFirst({
      where: { name: emp.name },
    });
    if (!employee) {
      employee = await prisma.digitalEmployee.create({
        data: {
          ...emp,
          status: 'APPROVED',
          version: '1.0',
          publishedAt: new Date(),
        },
      });
    }
    createdEmployees.push(employee);
  }
  console.log('✅ 3 employees created');

  // 9. 企业订阅（雇佣）这些员工
  for (const employee of createdEmployees) {
    await prisma.subscription.upsert({
      where: {
        enterpriseId_employeeId: {
          enterpriseId: enterprise.id,
          employeeId: employee.id,
        },
      },
      update: {},
      create: {
        enterpriseId: enterprise.id,
        employeeId: employee.id,
        status: 'ACTIVE',
        templateVersion: '1.0',
      },
    });
  }
  console.log('✅ Enterprise subscribed to all employees');

  // 10. 创建历史对话数据（最近 30 天）
  const now = new Date();
  const sessionsToCreate = [];

  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const date = new Date(now);
    date.setDate(date.getDate() - dayOffset);

    // 每天随机 3-10 个对话
    const sessionCount = Math.floor(Math.random() * 8) + 3;

    for (let i = 0; i < sessionCount; i++) {
      const randomUser = memberUsers[Math.floor(Math.random() * memberUsers.length)];
      const randomEmployee = createdEmployees[Math.floor(Math.random() * createdEmployees.length)];

      sessionsToCreate.push({
        title: `对话 ${date.toISOString().split('T')[0]}`,
        userId: randomUser.id,
        employeeId: randomEmployee.id,
        createdAt: date,
        updatedAt: date,
      });
    }
  }

  await prisma.conversationSession.createMany({
    data: sessionsToCreate,
    skipDuplicates: true,
  });
  console.log(`✅ Created ${sessionsToCreate.length} conversation sessions`);

  // 11. 添加一些算力消耗记录
  const sessions = await prisma.conversationSession.findMany({
    take: 50,
    orderBy: { createdAt: 'desc' },
  });

  for (const session of sessions) {
    const consumeAmount = Math.floor(Math.random() * 500) + 100; // 100-600
    await prisma.computeTransaction.create({
      data: {
        accountId: computeAccount.id,
        type: 'CONSUME',
        amount: -consumeAmount,
        description: `对话消耗 - ${session.title}`,
        sessionId: session.id,
        createdAt: session.createdAt,
      },
    });
  }
  console.log('✅ Added compute consumption records');

  console.log('🎉 Seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

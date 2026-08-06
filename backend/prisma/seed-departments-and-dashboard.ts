/**
 * 部门和工作台数据种子
 *
 * 为现有企业添加：
 * 1. 完整的部门结构（按照标准公司组织架构）
 * 2. 工作台模拟数据（消费趋势、热门员工、活动记录）
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始创建部门和工作台数据...\n');

  // 获取示例科技企业
  const enterprise = await prisma.enterprise.findFirst({
    where: { name: '示例科技' }
  });

  if (!enterprise) {
    console.log('❌ 未找到示例科技企业，请先运行 seed-boss-demo.ts');
    return;
  }

  console.log('✅ 找到企业:', enterprise.name, '\n');

  // ============================================================================
  // 1. 创建完整的部门结构
  // ============================================================================

  console.log('📁 创建部门结构...');

  // 一级部门
  const departments = [
    // 技术部门
    { id: 'dept-tech', name: '技术部', parentId: null, sortOrder: 1 },
    { id: 'dept-tech-dev', name: '研发组', parentId: 'dept-tech', sortOrder: 1 },
    { id: 'dept-tech-qa', name: '测试组', parentId: 'dept-tech', sortOrder: 2 },
    { id: 'dept-tech-ops', name: '运维组', parentId: 'dept-tech', sortOrder: 3 },

    // 产品部门
    { id: 'dept-product', name: '产品部', parentId: null, sortOrder: 2 },
    { id: 'dept-product-design', name: '设计组', parentId: 'dept-product', sortOrder: 1 },
    { id: 'dept-product-pm', name: '产品经理组', parentId: 'dept-product', sortOrder: 2 },

    // 市场部门
    { id: 'dept-marketing', name: '市场部', parentId: null, sortOrder: 3 },
    { id: 'dept-marketing-brand', name: '品牌组', parentId: 'dept-marketing', sortOrder: 1 },
    { id: 'dept-marketing-growth', name: '增长组', parentId: 'dept-marketing', sortOrder: 2 },

    // 销售部门
    { id: 'dept-sales', name: '销售部', parentId: null, sortOrder: 4 },
    { id: 'dept-sales-direct', name: '直销组', parentId: 'dept-sales', sortOrder: 1 },
    { id: 'dept-sales-channel', name: '渠道组', parentId: 'dept-sales', sortOrder: 2 },

    // 客服部门
    { id: 'dept-customer', name: '客户服务部', parentId: null, sortOrder: 5 },
    { id: 'dept-customer-support', name: '技术支持组', parentId: 'dept-customer', sortOrder: 1 },
    { id: 'dept-customer-success', name: '客户成功组', parentId: 'dept-customer', sortOrder: 2 },

    // 行政部门
    { id: 'dept-admin', name: '行政部', parentId: null, sortOrder: 6 },
    { id: 'dept-admin-hr', name: '人力资源组', parentId: 'dept-admin', sortOrder: 1 },
    { id: 'dept-admin-finance', name: '财务组', parentId: 'dept-admin', sortOrder: 2 },
    { id: 'dept-admin-legal', name: '法务组', parentId: 'dept-admin', sortOrder: 3 },
  ];

  for (const dept of departments) {
    await prisma.department.upsert({
      where: { id: dept.id },
      update: {},
      create: {
        id: dept.id,
        name: dept.name,
        parentId: dept.parentId,
        sortOrder: dept.sortOrder,
        enterpriseId: enterprise.id,
      },
    });
    const indent = dept.parentId ? '  ├─ ' : '├─ ';
    console.log(`${indent}${dept.name}`);
  }

  console.log('\n✅ 部门创建完成\n');

  // ============================================================================
  // 2. 创建工作台模拟数据（通过创建员工实例和调用记录）
  // ============================================================================

  console.log('📊 创建工作台模拟数据...\n');

  // 获取 boss 用户
  const bossUser = await prisma.user.findUnique({
    where: { email: 'boss@acme.local' }
  });

  if (!bossUser) {
    console.log('❌ 未找到 boss 用户');
    return;
  }

  // 获取 boss 用户对应的企业成员记录
  const bossMember = await prisma.enterpriseMember.findFirst({
    where: {
      userId: bossUser.id,
      enterpriseId: enterprise.id,
    },
  });

  if (!bossMember) {
    console.log('❌ 未找到 boss 的企业成员记录');
    return;
  }

  // 获取一些数字员工模板
  const templates = await prisma.digitalEmployee.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  if (templates.length === 0) {
    console.log('⚠️  未找到数字员工模板，跳过员工实例创建');
    return;
  }

  console.log(`找到 ${templates.length} 个数字员工模板\n`);

  // 创建员工实例
  const instances = [];
  for (let i = 0; i < Math.min(templates.length, 3); i++) {
    const template = templates[i];
    const instance = await prisma.employeeInstance.upsert({
      where: { id: `demo-instance-${i}` },
      update: {},
      create: {
        id: `demo-instance-${i}`,
        name: `${template.name}实例${i + 1}`,
        enterpriseId: enterprise.id,
        templateId: template.id,
        templateVersion: '1.0.0',
      },
    });
    instances.push(instance);
    console.log(`  ├─ 创建实例: ${instance.name}`);
  }

  console.log('\n✅ 员工实例创建完成\n');

  // 获取企业的计算账户
  const computeAccount = await prisma.computeAccount.findFirst({
    where: { enterpriseId: enterprise.id },
  });

  if (!computeAccount) {
    console.log('⚠️  未找到企业计算账户，跳过消费记录创建');
  } else {
    // 先删除已有的模拟数据
    console.log('🗑️  清理旧数据...');
    await prisma.computeTransaction.deleteMany({
      where: { id: { startsWith: 'tx-' } },
    });
    await prisma.conversationSession.deleteMany({
      where: { id: { startsWith: 'session-' } },
    });
    console.log('✅ 旧数据清理完成\n');

    // 创建对话会话和消费记录（模拟最近30天的活动）
    console.log('📝 创建对话会话和消费记录（模拟数据）...\n');

    const now = new Date();
    let sessionCount = 0;
    let transactionCount = 0;

    for (let day = 0; day < 30; day++) {
      const date = new Date(now);
      date.setDate(date.getDate() - day);

      // 每天随机2-5个会话
      const sessionsPerDay = Math.floor(Math.random() * 4) + 2;

      for (let i = 0; i < sessionsPerDay; i++) {
        const instance = instances[Math.floor(Math.random() * instances.length)];
        const sessionTime = new Date(date);
        sessionTime.setHours(Math.floor(Math.random() * 24));
        sessionTime.setMinutes(Math.floor(Math.random() * 60));

        // 创建会话
        const session = await prisma.conversationSession.create({
          data: {
            id: `session-${day}-${i}`,
            userId: bossUser.id,
            employeeId: templates[Math.floor(Math.random() * templates.length)].id,
            title: `工作会话 ${day + 1}-${i + 1}`,
            status: day > 3 ? 'ARCHIVED' : 'ACTIVE', // 最近3天为活跃，其他归档
            createdAt: sessionTime,
          },
        });
        sessionCount++;

        // 为这个会话创建1-3条消费记录
        const transactionsPerSession = Math.floor(Math.random() * 3) + 1;
        for (let j = 0; j < transactionsPerSession; j++) {
          const cost = Math.random() * 5 + 0.5; // 0.5-5.5元
          const txTime = new Date(sessionTime.getTime() + j * 60000); // 间隔1分钟

          await prisma.computeTransaction.create({
            data: {
              id: `tx-${day}-${i}-${j}`,
              accountId: computeAccount.id,
              type: 'CONSUME',
              amount: -cost,
              sessionId: session.id,
              description: `对话消费`,
              metadata: {
                instanceId: instance.id,
                memberId: bossMember.id,
              },
              createdAt: txTime,
            },
          });
          transactionCount++;
        }
      }
    }

    console.log(`  ├─ 创建了 ${sessionCount} 个对话会话`);
    console.log(`  ├─ 创建了 ${transactionCount} 条消费记录`);
    console.log(`  ├─ 时间范围: ${new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toLocaleDateString()} - ${now.toLocaleDateString()}`);
    console.log('\n✅ 工作台数据创建完成\n');
  }

  console.log('🎉 所有数据创建完成！\n');
  console.log('现在可以访问以下页面查看效果：');
  console.log('  - 部门管理: http://localhost:3000/departments');
  console.log('  - 工作台: http://localhost:3000/dashboard');
}

main()
  .catch((e) => {
    console.error('❌ 错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

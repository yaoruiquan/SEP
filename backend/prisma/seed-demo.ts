/**
 * 前端 UI/UX 优化 - 最简示例数据
 *
 * 只创建用户和对话，展示 UI 效果
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始填充示例数据...\n');

  // 1. 创建测试用户
  const testUser = await prisma.user.upsert({
    where: { email: 'demo@sep.com' },
    update: {},
    create: {
      email: 'demo@sep.com',
      password: await bcrypt.hash('demo123', 10),
      name: '演示用户',
      role: 'USER',
    },
  });
  console.log('✅ 用户:', testUser.email);

  // 2. 查找或创建一个员工模板（平台级）
  let employee = await prisma.digitalEmployee.findFirst();

  if (!employee) {
    employee = await prisma.digitalEmployee.create({
      data: {
        name: '通用助手',
        description: '多功能智能助手',
        industry: '通用',
        position: '助理',
        systemPrompt: '你是一个有帮助的AI助手',
        modelId: 'gpt-4o',
        // EmployeeStatus 没有 PUBLISHED，「已上架」是 APPROVED
        status: 'APPROVED',
        version: '1.0.0',
      },
    });
    console.log('✅ 创建员工模板:', employee.name);
  } else {
    console.log('✅ 使用现有员工:', employee.name);
  }

  // 3. 创建 20 个示例对话
  const taskTitles = [
    '分析上季度销售数据',
    '生成产品需求文档',
    '撰写技术博客：Next.js 15 新特性',
    '处理客户投诉：订单延迟',
    '生成本周工作周报',
    '分析竞品定价策略',
    '整理会议纪要：产品评审会',
    '制作财务月报',
    '回答：如何重置密码？',
    '优化网站 SEO 关键词',
    '生成营销邮件模板',
    '分析用户留存率',
    '撰写 API 接口文档',
    '处理退款申请',
    '生成季度 OKR 报告',
    '整理客户反馈',
    '制作数据可视化看板',
    '审查数据库查询性能',
    '分析流失用户原因',
    '生成竞品分析报告',
  ];

  const now = new Date();
  let createdCount = 0;

  for (let i = 0; i < taskTitles.length; i++) {
    const createdAt = new Date(now.getTime() - (taskTitles.length - i) * 60 * 60 * 1000);

    const existing = await prisma.conversationSession.findFirst({
      where: { userId: testUser.id },
    });

    if (!existing || i < 5) {
      // 只创建前5个，避免太多
      const conversation = await prisma.conversationSession.create({
        data: {
          employeeId: employee.id,
          userId: testUser.id,
          createdAt,
          updatedAt: i < 2 ? createdAt : new Date(createdAt.getTime() + 3 * 60 * 1000),
        },
      });

      createdCount++;
    }
  }

  console.log(`\n✅ 对话任务: ${createdCount} 个新创建`);
  console.log('🎉 示例数据填充完成！\n');
  console.log('📋 登录信息:');
  console.log('   邮箱: demo@sep.com');
  console.log('   密码: demo123');
  console.log('\n🚀 访问 http://localhost:3000 查看优化效果');
  console.log('   - Dashboard 数据卡片');
  console.log('   - 任务列表交互');
  console.log('   - Toast 通知');
  console.log('   - Loading 状态\n');
}

main()
  .catch((e) => {
    console.error('❌ 填充失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

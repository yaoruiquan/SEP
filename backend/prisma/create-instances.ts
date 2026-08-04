/**
 * 创建员工实例数据
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 创建员工实例数据...\n');

  // 1. 找到演示用户和企业
  const testUser = await prisma.user.findUnique({
    where: { email: 'demo@sep.com' },
  });

  if (!testUser) {
    console.error('❌ 用户不存在');
    process.exit(1);
  }

  const enterprise = await prisma.enterprise.findFirst({
    where: {
      members: {
        some: { userId: testUser.id },
      },
    },
  });

  if (!enterprise) {
    console.error('❌ 企业不存在');
    process.exit(1);
  }

  console.log('✅ 找到企业:', enterprise.name);

  // 2. 找到所有员工模板
  const employees = await prisma.digitalEmployee.findMany({
    where: { status: 'APPROVED' },
    take: 5,
  });

  console.log(`✅ 找到 ${employees.length} 个员工模板\n`);

  // 3. 为每个模板创建实例
  for (const employee of employees) {
    const existing = await prisma.employeeInstance.findFirst({
      where: {
        templateId: employee.id,
        enterpriseId: enterprise.id,
      },
    });

    if (!existing) {
      await prisma.employeeInstance.create({
        data: {
          templateId: employee.id,
          enterpriseId: enterprise.id,
          name: employee.name, // 使用默认名称
          templateVersion: employee.version,
          status: 'ACTIVE',
        },
      });
      console.log(`✅ 创建实例: ${employee.name}`);
    } else {
      console.log(`⏭️  实例已存在: ${employee.name}`);
    }
  }

  console.log('\n🎉 员工实例创建完成！');
  console.log('🚀 刷新页面查看效果\n');
}

main()
  .catch((e) => {
    console.error('❌ 创建失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

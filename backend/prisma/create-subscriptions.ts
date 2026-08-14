/**
 * 补数据小工具：给演示用户所属企业批量建立雇佣关系。
 *
 * 收敛前叫 create-instances.ts，建的是 EmployeeInstance；该模型已删除，
 * 现在直接建 Subscription（雇佣关系本身即权限锚点）。
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 创建雇佣关系数据...\n');

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

  // 2. 找到所有已上架员工
  const employees = await prisma.digitalEmployee.findMany({
    where: { status: 'APPROVED' },
    take: 5,
  });

  console.log(`✅ 找到 ${employees.length} 个员工\n`);

  // 3. 逐个雇佣。一企业一员工只有一段雇佣关系，
  //    唯一约束 (enterpriseId, employeeId) 保证重复执行幂等
  for (const employee of employees) {
    const existing = await prisma.subscription.findUnique({
      where: {
        enterpriseId_employeeId: {
          enterpriseId: enterprise.id,
          employeeId: employee.id,
        },
      },
    });

    if (!existing) {
      await prisma.subscription.create({
        data: {
          employeeId: employee.id,
          enterpriseId: enterprise.id,
          // 雇佣时锁定版本：模板发新版只提示，不自动跟进
          templateVersion: employee.version,
          status: 'ACTIVE',
        },
      });
      console.log(`✅ 已雇佣: ${employee.name}`);
    } else {
      console.log(`⏭️  已在册: ${employee.name}`);
    }
  }

  console.log('\n🎉 雇佣关系创建完成！');
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

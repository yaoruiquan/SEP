/**
 * 给演示用户添加企业管理员权限
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 添加企业权限...\n');

  // 1. 找到演示用户
  const testUser = await prisma.user.findUnique({
    where: { email: 'demo@sep.com' },
  });

  if (!testUser) {
    console.error('❌ 用户 demo@sep.com 不存在，请先运行 seed-demo.ts');
    process.exit(1);
  }

  // 2. 查找或创建企业
  let enterprise = await prisma.enterprise.findFirst({
    where: { name: '演示企业' },
  });

  if (!enterprise) {
    enterprise = await prisma.enterprise.create({
      data: {
        name: '演示企业',
        description: '用于演示的企业账户',
      },
    });
    console.log('✅ 创建企业:', enterprise.name);
  } else {
    console.log('✅ 使用现有企业:', enterprise.name);
  }

  // 3. 添加用户为企业管理员
  const existing = await prisma.enterpriseMember.findFirst({
    where: {
      userId: testUser.id,
      enterpriseId: enterprise.id,
    },
  });

  if (!existing) {
    await prisma.enterpriseMember.create({
      data: {
        userId: testUser.id,
        enterpriseId: enterprise.id,
        role: 'ENTERPRISE_ADMIN',
      },
    });
    console.log('✅ 添加企业管理员权限');
  } else {
    console.log('✅ 已有企业成员权限');
  }

  console.log('\n🎉 权限配置完成！');
  console.log('🚀 现在可以访问企业端页面了\n');
}

main()
  .catch((e) => {
    console.error('❌ 配置失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

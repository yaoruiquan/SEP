/**
 * Boss 演示专用种子数据
 *
 * 创建账号：
 * - boss@acme.local (示例科技·企业管理员)
 * - staff@acme.local (示例科技·普通成员·技术部)
 * - boss@globex.local (另一家公司·企业管理员)
 * - admin@sep.local (平台运营)
 *
 * 统一密码：Demo123456
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始创建 Boss 演示账号...\n');

  const demoPassword = await bcrypt.hash('Demo123456', 10);

  // ============================================================================
  // 1. 创建平台运营账号
  // ============================================================================

  const admin = await prisma.user.upsert({
    where: { email: 'admin@sep.local' },
    update: { password: demoPassword },
    create: {
      email: 'admin@sep.local',
      password: demoPassword,
      name: '平台运营',
      role: 'ADMIN',
    },
  });
  console.log('✅ 平台运营:', admin.email, '(ADMIN)');

  // ============================================================================
  // 2. 创建示例科技（ACME）
  // ============================================================================

  const acmeEnterprise = await prisma.enterprise.upsert({
    where: { id: 'acme-enterprise-id' },
    update: {},
    create: {
      id: 'acme-enterprise-id',
      name: '示例科技',
      description: '一家专注于 AI 技术的示例企业',
    },
  });
  console.log('\n✅ 企业:', acmeEnterprise.name);

  // 创建技术部
  const techDept = await prisma.department.upsert({
    where: { id: 'acme-tech-dept-id' },
    update: {},
    create: {
      id: 'acme-tech-dept-id',
      name: '技术部',
      enterpriseId: acmeEnterprise.id,
    },
  });
  console.log('  ├─ 部门:', techDept.name);

  // Boss 账号
  const acmeBoss = await prisma.user.upsert({
    where: { email: 'boss@acme.local' },
    update: { password: demoPassword },
    create: {
      email: 'boss@acme.local',
      password: demoPassword,
      name: '张总',
      role: 'USER',
    },
  });

  await prisma.enterpriseMember.upsert({
    where: {
      userId_enterpriseId: {
        userId: acmeBoss.id,
        enterpriseId: acmeEnterprise.id,
      },
    },
    update: { role: 'ENTERPRISE_ADMIN' },
    create: {
      userId: acmeBoss.id,
      enterpriseId: acmeEnterprise.id,
      role: 'ENTERPRISE_ADMIN',
    },
  });
  console.log('  ├─ 管理员:', acmeBoss.email, '(张总)');

  // Staff 账号
  const acmeStaff = await prisma.user.upsert({
    where: { email: 'staff@acme.local' },
    update: { password: demoPassword },
    create: {
      email: 'staff@acme.local',
      password: demoPassword,
      name: '李工',
      role: 'USER',
    },
  });

  await prisma.enterpriseMember.upsert({
    where: {
      userId_enterpriseId: {
        userId: acmeStaff.id,
        enterpriseId: acmeEnterprise.id,
      },
    },
    update: {
      role: 'MEMBER',
      departmentId: techDept.id,
    },
    create: {
      userId: acmeStaff.id,
      enterpriseId: acmeEnterprise.id,
      role: 'MEMBER',
      departmentId: techDept.id,
    },
  });
  console.log('  └─ 成员:', acmeStaff.email, '(李工·技术部)');

  // ============================================================================
  // 3. 创建另一家公司（Globex）
  // ============================================================================

  const globexEnterprise = await prisma.enterprise.upsert({
    where: { id: 'globex-enterprise-id' },
    update: {},
    create: {
      id: 'globex-enterprise-id',
      name: '全球公司',
      description: '一家跨国企业集团',
    },
  });
  console.log('\n✅ 企业:', globexEnterprise.name);

  const globexBoss = await prisma.user.upsert({
    where: { email: 'boss@globex.local' },
    update: { password: demoPassword },
    create: {
      email: 'boss@globex.local',
      password: demoPassword,
      name: '王总',
      role: 'USER',
    },
  });

  await prisma.enterpriseMember.upsert({
    where: {
      userId_enterpriseId: {
        userId: globexBoss.id,
        enterpriseId: globexEnterprise.id,
      },
    },
    update: { role: 'ENTERPRISE_ADMIN' },
    create: {
      userId: globexBoss.id,
      enterpriseId: globexEnterprise.id,
      role: 'ENTERPRISE_ADMIN',
    },
  });
  console.log('  └─ 管理员:', globexBoss.email, '(王总)');

  // ============================================================================
  // 4. 创建算力账户（初始余额）
  // ============================================================================

  await prisma.computeAccount.upsert({
    where: { enterpriseId: acmeEnterprise.id },
    update: { balance: 100000 },
    create: {
      enterpriseId: acmeEnterprise.id,
      balance: 100000, // 10万 tokens
    },
  });

  await prisma.computeAccount.upsert({
    where: { enterpriseId: globexEnterprise.id },
    update: { balance: 50000 },
    create: {
      enterpriseId: globexEnterprise.id,
      balance: 50000, // 5万 tokens
    },
  });

  console.log('\n✅ 算力账户已初始化');

  console.log('\n🎉 Boss 演示账号创建完成！\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 登录信息（密码统一：Demo123456）\n');
  console.log('  示例科技（ACME）');
  console.log('  ├─ boss@acme.local   (企业管理员·张总)');
  console.log('  └─ staff@acme.local  (普通成员·李工·技术部)\n');
  console.log('  全球公司（Globex）');
  console.log('  └─ boss@globex.local (企业管理员·王总)\n');
  console.log('  平台运营');
  console.log('  └─ admin@sep.local   (运营端 /admin)\n');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('⚠️  Demo123456 是演示专用弱密码，生产环境必须换掉！\n');
}

main()
  .catch((e) => {
    console.error('❌ 种子数据填充失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

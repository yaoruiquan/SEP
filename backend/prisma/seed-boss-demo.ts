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
  // ============================================================================
  // 8. 初始化扩展配置项
  // ============================================================================

  console.log('\n⚙️  初始化系统配置...');

  const extendedSettings = [
    // 平台基础信息
    { key: 'PLATFORM_NAME', label: '平台名称', value: '硅基人才平台', isSecret: false },
    { key: 'PLATFORM_LOGO_URL', label: '平台Logo地址', value: '', isSecret: false },
    { key: 'SUPPORT_EMAIL', label: '客服邮箱', value: 'support@sep.local', isSecret: false },
    { key: 'SUPPORT_PHONE', label: '客服电话', value: '', isSecret: false },
    { key: 'ICP_NUMBER', label: '备案号', value: '', isSecret: false },
    // 计费配置
    { key: 'FALLBACK_PRICE_INPUT', label: '保底计费-输入价格 (元/1K tokens)', value: '0.001', isSecret: false },
    { key: 'FALLBACK_PRICE_OUTPUT', label: '保底计费-输出价格 (元/1K tokens)', value: '0.002', isSecret: false },
    { key: 'NEW_ENTERPRISE_GIFT_TOKENS', label: '新企业赠送额度 (tokens)', value: '100000', isSecret: false },
    { key: 'LOW_BALANCE_THRESHOLD', label: '低余额告警阈值 (tokens)', value: '10000', isSecret: false },
    // 安全与限制
    { key: 'MAX_TOKENS_PER_CONVERSATION', label: '单次对话最大tokens', value: '32000', isSecret: false },
    { key: 'MAX_CONCURRENT_SESSIONS', label: '单企业并发会话数 (0=不限制)', value: '10', isSecret: false },
    { key: 'ADMIN_IP_WHITELIST', label: '管理员IP白名单 (逗号分隔)', value: '', isSecret: false },
    // 注册与审核
    { key: 'ENTERPRISE_REGISTRATION_APPROVAL', label: '企业注册需人工审核', value: 'true', isSecret: false },
    { key: 'SEND_WELCOME_EMAIL', label: '审核通过发送欢迎邮件', value: 'false', isSecret: false },
    // 内容审核
    { key: 'CONTENT_FILTER_ENABLED', label: '敏感词过滤开关', value: 'false', isSecret: false },
    // 数据保留
    { key: 'CONVERSATION_RETENTION_DAYS', label: '对话记录保留天数 (0=永久)', value: '90', isSecret: false },
    { key: 'OPERATION_LOG_RETENTION_DAYS', label: '操作日志保留天数 (0=永久)', value: '180', isSecret: false },
    { key: 'SOFT_DELETE_RETENTION_DAYS', label: '软删除数据保留天数', value: '30', isSecret: false },
    // 性能与缓存
    { key: 'REDIS_CACHE_ENABLED', label: 'Redis缓存开关', value: 'true', isSecret: false },
    { key: 'CONVERSATION_CACHE_TTL', label: '对话历史缓存时长 (秒)', value: '3600', isSecret: false },
    { key: 'MODEL_RESPONSE_TIMEOUT', label: '模型响应超时 (秒)', value: '120', isSecret: false },
    // 通知配置
    { key: 'ADMIN_NOTIFICATION_EMAIL', label: '管理员通知邮箱', value: '', isSecret: false },
    { key: 'ABNORMAL_USAGE_THRESHOLD', label: '异常消耗告警阈值 (单小时tokens)', value: '100000', isSecret: false },
    { key: 'SYSTEM_MAINTENANCE_NOTICE', label: '系统维护公告', value: '', isSecret: false },
  ];

  let settingsCreated = 0;
  for (const setting of extendedSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
    settingsCreated++;
  }
  console.log(`✅ 系统配置: ${settingsCreated} 个配置项已初始化`);

  console.log('\n═══════════════════════════════════════════════════════════');
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

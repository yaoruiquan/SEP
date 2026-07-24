/**
 * 演示种子数据 (Demo seed)
 * 运行: pnpm db:seed  (等价于 prisma db seed)
 *
 * 铺设一条完整演示链:
 *   admin@sep.local (ADMIN)  ── 上架 3 个数字员工
 *   user@sep.local  (USER)   ── 已订阅「小海」,登录后仪表盘不空
 *   4 个能力覆盖 4 种类型(AGENT/SKILL/RPA/AI_APP),各带不同行业/岗位标签
 *
 * 幂等: 全部用固定 id + upsert,可重复运行。
 * 统一密码: Demo123456
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo123456';

// 简单的 JSON Schema 占位(输入/输出校验用)
const TEXT_IN = { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] };
const TEXT_OUT = { type: 'object', properties: { output: { type: 'string' } } };

async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@sep.local' },
    update: { role: 'ADMIN' as any, name: '平台管理员' },
    create: {
      id: 'demo-user-admin',
      email: 'admin@sep.local',
      password: passwordHash,
      name: '平台管理员',
      role: 'ADMIN' as any,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'user@sep.local' },
    update: { role: 'USER' as any, name: '演示用户' },
    create: {
      id: 'demo-user-normal',
      email: 'user@sep.local',
      password: passwordHash,
      name: '演示用户',
      role: 'USER' as any,
    },
  });

  return { admin, user };
}

async function seedCapabilities(contributorId: string) {
  const now = new Date();
  const base = {
    inputSchema: TEXT_IN,
    outputSchema: TEXT_OUT,
    contributorId,
    status: 'APPROVED' as any,
    approvedAt: now,
  };

  // 能力 1 — AGENT(联网搜索),标签: 跨境电商 / 市场·运营
  const searchCap = await prisma.capability.upsert({
    where: { id: 'demo-cap-search' },
    update: {},
    create: {
      ...base,
      id: 'demo-cap-search',
      name: '联网搜索',
      description: '实时联网检索,汇总要点并给出来源链接',
      type: 'AGENT' as any,
      industry: ['跨境电商', '互联网'],
      position: ['市场', '运营'],
      usageCount: 128,
      rating: 4.7,
      agentConfig: { create: { platform: 'OPENCODE' as any, skillName: 'web-search' } },
    },
  });

  // 能力 2 — SKILL(营销文案),标签: 电商 / 内容·运营
  const copyCap = await prisma.capability.upsert({
    where: { id: 'demo-cap-copywriting' },
    update: {},
    create: {
      ...base,
      id: 'demo-cap-copywriting',
      name: '营销文案生成',
      description: '按卖点和平台调性生成小红书/详情页文案',
      type: 'SKILL' as any,
      industry: ['电商', '教育'],
      position: ['内容运营', '市场'],
      usageCount: 342,
      rating: 4.9,
      skillConfig: {
        create: {
          template: '你是资深电商文案。请根据以下卖点生成 3 版文案:\n{{input}}',
          modelId: 'gemini-3.5-flash-high',
          temperature: 0.8,
          maxTokens: 2000,
        },
      },
    },
  });

  // 能力 3 — RPA(表格抓取),标签: 金融 / 数据分析
  const rpaCap = await prisma.capability.upsert({
    where: { id: 'demo-cap-rpa-scrape' },
    update: {},
    create: {
      ...base,
      id: 'demo-cap-rpa-scrape',
      name: '报表数据抓取',
      description: '自动登录后台,抓取每日经营报表并导出 Excel',
      type: 'RPA' as any,
      industry: ['金融', '零售'],
      position: ['数据分析', '财务'],
      usageCount: 56,
      rating: 4.5,
      rpaConfig: {
        create: {
          platform: 'YINGDAO' as any,
          executionMode: 'CLOUD' as any,
          configDoc: '需在订阅配置里填写后台账号',
        },
      },
    },
  });

  // 能力 4 — AI_APP(数据看板),标签: 通用 / 数据分析
  const appCap = await prisma.capability.upsert({
    where: { id: 'demo-cap-dashboard' },
    update: {},
    create: {
      ...base,
      id: 'demo-cap-dashboard',
      name: '可视化数据看板',
      description: '把结构化数据一键生成交互式图表看板',
      type: 'AI_APP' as any,
      industry: ['通用'],
      position: ['数据分析', '运营'],
      usageCount: 89,
      rating: 4.6,
      aiAppConfig: {
        create: { integrationMode: 'IFRAME' as any, webUrl: 'https://example.com/dashboard' },
      },
    },
  });

  return { searchCap, copyCap, rpaCap, appCap };
}

type Caps = Awaited<ReturnType<typeof seedCapabilities>>;

async function seedEmployees(caps: Caps) {
  const now = new Date();
  const MODEL = 'gemini-3.5-flash-high';

  // 员工 1 — 小海(海外获客助理): 搜索 + 文案
  const hai = await prisma.digitalEmployee.upsert({
    where: { id: 'demo-emp-hai' },
    update: { status: 'PUBLISHED' as any },
    create: {
      id: 'demo-emp-hai',
      name: '小海',
      description: '海外获客助理,帮你调研市场、找客户、写开发信',
      industry: '跨境电商',
      position: '市场',
      avatar: null,
      systemPrompt:
        '你是「小海」,一名资深海外获客助理。擅长市场调研、客户开发和多语种营销文案。回答专业、简洁、可执行。',
      modelId: MODEL,
      maxSteps: 10,
      status: 'PUBLISHED' as any,
      price: 0,
      publishedAt: now,
      bindings: {
        create: [
          { capabilityId: caps.searchCap.id, order: 1 },
          { capabilityId: caps.copyCap.id, order: 2 },
        ],
      },
    },
  });

  // 员工 2 — 阿析(数据分析师): RPA 抓取 + 看板
  const xi = await prisma.digitalEmployee.upsert({
    where: { id: 'demo-emp-xi' },
    update: { status: 'PUBLISHED' as any },
    create: {
      id: 'demo-emp-xi',
      name: '阿析',
      description: '数据分析师,自动抓取经营数据并生成可视化看板',
      industry: '金融',
      position: '数据分析',
      systemPrompt:
        '你是「阿析」,一名严谨的数据分析师。擅长数据抓取、清洗与可视化解读,结论先行、附关键指标。',
      modelId: MODEL,
      maxSteps: 10,
      status: 'PUBLISHED' as any,
      price: 0,
      publishedAt: now,
      bindings: {
        create: [
          { capabilityId: caps.rpaCap.id, order: 1 },
          { capabilityId: caps.appCap.id, order: 2 },
        ],
      },
    },
  });

  // 员工 3 — 小文(文案助手): 纯文案
  const wen = await prisma.digitalEmployee.upsert({
    where: { id: 'demo-emp-wen' },
    update: { status: 'PUBLISHED' as any },
    create: {
      id: 'demo-emp-wen',
      name: '小文',
      description: '文案助手,各平台营销文案信手拈来',
      industry: '电商',
      position: '内容运营',
      systemPrompt: '你是「小文」,一名爆款文案高手。风格活泼有网感,擅长小红书、详情页、短视频脚本。',
      modelId: MODEL,
      maxSteps: 6,
      status: 'PUBLISHED' as any,
      price: 0,
      publishedAt: now,
      bindings: { create: [{ capabilityId: caps.copyCap.id, order: 1 }] },
    },
  });

  return { hai, xi, wen };
}

async function seedSubscription(userId: string, employeeId: string) {
  await prisma.subscription.upsert({
    where: { userId_employeeId: { userId, employeeId } },
    update: { status: 'ACTIVE' as any },
    create: { userId, employeeId, status: 'ACTIVE' as any },
  });
}

async function main() {
  console.log('🌱 Seeding demo data...');
  const { admin, user } = await seedUsers();
  const caps = await seedCapabilities(admin.id);
  const emps = await seedEmployees(caps);
  await seedSubscription(user.id, emps.hai.id); // 演示用户已订阅小海

  console.log('✅ Seed done.');
  console.log('   Admin: admin@sep.local / Demo123456');
  console.log('   User : user@sep.local  / Demo123456  (已订阅「小海」)');
  console.log(`   员工 ${Object.keys(emps).length} 个 · 能力 ${Object.keys(caps).length} 个(4 种类型)`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

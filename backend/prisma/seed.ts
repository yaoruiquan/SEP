/**
 * 演示数据种子（P0 企业组织版）
 *
 * 关键设计：**造两家企业**，而不是一家。
 * 单企业数据无法暴露多租户越权 —— 所有查询即使漏掉 enterpriseId 过滤
 * 也一样返回正确结果。有了第二家企业，越权测试才有对照物：
 * 拿甲方的 token 去查乙方的资源，必须失败。
 *
 * 账号（密码统一 Demo123456）：
 *   admin@sep.local     平台运营（UserRole.ADMIN，不属于任何企业）
 *   boss@acme.local     甲企业 · 企业管理员
 *   dev@acme.local      甲企业 · 部门负责人（技术部）
 *   staff@acme.local    甲企业 · 普通成员（技术部）
 *   boss@globex.local   乙企业 · 企业管理员（越权测试对照）
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo123456';

// 能力 input/output schema（沿用，与本期改造无关）
const TEXT_IN = { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] };
const TEXT_OUT = { type: 'object', properties: { output: { type: 'string' } } };

// ── 用户 ────────────────────────────────────────────────────────────────────

async function seedUsers() {
  const pw = await bcrypt.hash(DEMO_PASSWORD, 10);

  const mk = (id: string, email: string, name: string, role: 'ADMIN' | 'USER') =>
    prisma.user.upsert({
      where: { email },
      update: { role: role as any, name },
      create: { id, email, password: pw, name, role: role as any },
    });

  // 平台运营：UserRole.ADMIN 现在只表示「平台运营人员」，
  // 企业内角色一律落在 EnterpriseMember.role
  const platformAdmin = await mk('demo-user-admin', 'admin@sep.local', '平台运营', 'ADMIN');

  const acmeBoss = await mk('demo-user-acme-boss', 'boss@acme.local', '甲总', 'USER');
  const acmeDev = await mk('demo-user-acme-dev', 'dev@acme.local', '技术负责人', 'USER');
  const acmeStaff = await mk('demo-user-acme-staff', 'staff@acme.local', '技术员', 'USER');
  const globexBoss = await mk('demo-user-globex-boss', 'boss@globex.local', '乙总', 'USER');

  return { platformAdmin, acmeBoss, acmeDev, acmeStaff, globexBoss };
}

// ── 企业 / 部门 / 成员 ──────────────────────────────────────────────────────

async function seedEnterprises(users: Awaited<ReturnType<typeof seedUsers>>) {
  // 甲企业：完整组织结构，用于功能演示
  const acme = await prisma.enterprise.upsert({
    where: { id: 'demo-ent-acme' },
    update: {},
    create: {
      id: 'demo-ent-acme',
      name: '示例科技有限公司',
      description: '演示用企业，含完整部门与成员结构',
      computeAccount: { create: { balance: 100 } },
    },
  });

  // 乙企业：仅用于越权对照，结构从简
  const globex = await prisma.enterprise.upsert({
    where: { id: 'demo-ent-globex' },
    update: {},
    create: {
      id: 'demo-ent-globex',
      name: '另一家公司',
      description: '越权测试对照企业 —— 甲企业账号不得访问本企业任何数据',
      computeAccount: { create: { balance: 50 } },
    },
  });

  // 甲企业部门（技术部下挂前端组，验证树形结构）
  const techDept = await prisma.department.upsert({
    where: { id: 'demo-dept-tech' },
    update: {},
    create: { id: 'demo-dept-tech', enterpriseId: acme.id, name: '技术部' },
  });
  await prisma.department.upsert({
    where: { id: 'demo-dept-fe' },
    update: {},
    create: {
      id: 'demo-dept-fe',
      enterpriseId: acme.id,
      name: '前端组',
      parentId: techDept.id,
    },
  });
  const opsDept = await prisma.department.upsert({
    where: { id: 'demo-dept-ops' },
    update: {},
    create: { id: 'demo-dept-ops', enterpriseId: acme.id, name: '运营部' },
  });

  // 成员（三种企业内角色各一，用于权限矩阵验证）
  const mkMember = (
    id: string,
    userId: string,
    enterpriseId: string,
    role: 'ENTERPRISE_ADMIN' | 'DEPT_MANAGER' | 'MEMBER',
    departmentId?: string,
  ) =>
    prisma.enterpriseMember.upsert({
      where: { userId_enterpriseId: { userId, enterpriseId } },
      update: { role: role as any, departmentId: departmentId ?? null },
      create: { id, userId, enterpriseId, role: role as any, departmentId },
    });

  const bossMember = await mkMember(
    'demo-mem-acme-boss',
    users.acmeBoss.id,
    acme.id,
    'ENTERPRISE_ADMIN',
  );
  const devMember = await mkMember(
    'demo-mem-acme-dev',
    users.acmeDev.id,
    acme.id,
    'DEPT_MANAGER',
    techDept.id,
  );
  const staffMember = await mkMember(
    'demo-mem-acme-staff',
    users.acmeStaff.id,
    acme.id,
    'MEMBER',
    techDept.id,
  );
  await mkMember(
    'demo-mem-globex-boss',
    users.globexBoss.id,
    globex.id,
    'ENTERPRISE_ADMIN',
  );

  return { acme, globex, techDept, opsDept, bossMember, devMember, staffMember };
}

// ── 能力 ────────────────────────────────────────────────────────────────────

async function seedCapabilities(contributorId: string) {
  const now = new Date();
  const base = {
    industry: ['通用'],
    position: ['通用'],
    inputSchema: TEXT_IN as any,
    outputSchema: TEXT_OUT as any,
    contributorId,
    status: 'APPROVED' as any,
    approvedAt: now,
  };

  const searchCap = await prisma.capability.upsert({
    where: { id: 'demo-cap-search' },
    update: { status: 'APPROVED' as any },
    create: {
      ...base,
      id: 'demo-cap-search',
      name: '联网搜索',
      description: '检索公开网络信息并归纳要点',
      type: 'AGENT' as any,
      agentConfig: {
        create: { platform: 'OPENCODE' as any, skillName: 'web-search' },
      },
    },
  });

  const copyCap = await prisma.capability.upsert({
    where: { id: 'demo-cap-copy' },
    update: { status: 'APPROVED' as any },
    create: {
      ...base,
      id: 'demo-cap-copy',
      name: '营销文案生成',
      description: '按平台风格产出营销文案',
      type: 'SKILL' as any,
      skillConfig: {
        create: {
          template: '请为以下内容撰写营销文案：\n{{input}}',
          modelId: 'gemini-3.5-flash-high',
          temperature: 0.8,
          maxTokens: 2000,
        },
      },
    },
  });

  return { searchCap, copyCap };
}

// ── 员工模板（市场侧）───────────────────────────────────────────────────────

async function seedTemplates(caps: Awaited<ReturnType<typeof seedCapabilities>>) {
  const now = new Date();
  const MODEL = 'gemini-3.5-flash-high';

  // 模板 1：技能包形态 —— 对应第一个真实员工（下载 skills 包）
  const skillsEmp = await prisma.digitalEmployee.upsert({
    where: { id: 'demo-emp-skills' },
    update: { status: 'APPROVED' as any },
    create: {
      id: 'demo-emp-skills',
      name: '文案助手（技能包）',
      description:
        '下载后将 skills 目录拷入你的 agent 即可使用。含营销文案、改写、润色三个技能。',
      industry: '电商',
      position: '内容运营',
      systemPrompt: '你是一名爆款文案高手，擅长小红书、详情页、短视频脚本。',
      modelId: MODEL,
      maxSteps: 6,
      status: 'APPROVED' as any,
      price: 0,
      publishedAt: now,
      version: '1.0.0',
      bindings: { create: [{ capabilityId: caps.copyCap.id, priority: 1 }] },
    },
  });

  // 模板 2：用于演示「同企业多实例」（决策 16）
  const researchEmp = await prisma.digitalEmployee.upsert({
    where: { id: 'demo-emp-research' },
    update: { status: 'APPROVED' as any },
    create: {
      id: 'demo-emp-research',
      name: '市场调研员',
      description: '检索公开信息并输出结构化调研简报',
      industry: '跨境电商',
      position: '市场',
      systemPrompt: '你是一名资深市场调研员，结论先行，附关键数据来源。',
      modelId: MODEL,
      maxSteps: 10,
      status: 'APPROVED' as any,
      price: 0,
      publishedAt: now,
      version: '1.0.0',
      bindings: { create: [{ capabilityId: caps.searchCap.id, priority: 1 }] },
    },
  });

  // 未上架模板：验证市场只展示 APPROVED
  await prisma.digitalEmployee.upsert({
    where: { id: 'demo-emp-draft' },
    update: {},
    create: {
      id: 'demo-emp-draft',
      name: '待上架员工',
      description: '草稿状态，不应出现在市场列表',
      industry: '通用',
      position: '通用',
      systemPrompt: '（草稿）',
      modelId: MODEL,
      status: 'DRAFT' as any,
      version: '0.1.0',
    },
  });

  return { skillsEmp, researchEmp };
}

// ── 订阅与实例 ──────────────────────────────────────────────────────────────

async function seedSubscriptionsAndInstances(
  ents: Awaited<ReturnType<typeof seedEnterprises>>,
  tpls: Awaited<ReturnType<typeof seedTemplates>>,
) {
  // 甲企业订阅两个模板
  for (const emp of [tpls.skillsEmp, tpls.researchEmp]) {
    await prisma.subscription.upsert({
      where: {
        enterpriseId_employeeId: {
          enterpriseId: ents.acme.id,
          employeeId: emp.id,
        },
      },
      update: { status: 'ACTIVE' as any },
      create: {
        enterpriseId: ents.acme.id,
        employeeId: emp.id,
        status: 'ACTIVE' as any,
      },
    });
  }

  // 实例：同一模板开两个实例（决策 16 —— 不同部门各一份）
  await prisma.employeeInstance.upsert({
    where: { id: 'demo-inst-copy-tech' },
    update: {},
    create: {
      id: 'demo-inst-copy-tech',
      enterpriseId: ents.acme.id,
      templateId: tpls.skillsEmp.id,
      templateVersion: '1.0.0',
      name: '技术部文案助手',
      departmentId: ents.techDept.id,
      status: 'ACTIVE' as any,
    },
  });
  await prisma.employeeInstance.upsert({
    where: { id: 'demo-inst-copy-ops' },
    update: {},
    create: {
      id: 'demo-inst-copy-ops',
      enterpriseId: ents.acme.id,
      templateId: tpls.skillsEmp.id,
      templateVersion: '1.0.0',
      name: '运营部文案助手',
      departmentId: ents.opsDept.id,
      status: 'ACTIVE' as any,
    },
  });

  // 乙企业也订阅同一模板 —— 用于验证实例不会跨企业泄漏
  await prisma.subscription.upsert({
    where: {
      enterpriseId_employeeId: {
        enterpriseId: ents.globex.id,
        employeeId: tpls.skillsEmp.id,
      },
    },
    update: { status: 'ACTIVE' as any },
    create: {
      enterpriseId: ents.globex.id,
      employeeId: tpls.skillsEmp.id,
      status: 'ACTIVE' as any,
    },
  });
  const globexInstance = await prisma.employeeInstance.upsert({
    where: { id: 'demo-inst-globex' },
    update: {},
    create: {
      id: 'demo-inst-globex',
      enterpriseId: ents.globex.id,
      templateId: tpls.skillsEmp.id,
      templateVersion: '1.0.0',
      name: '乙企业文案助手',
      status: 'ACTIVE' as any,
    },
  });

  // 授权：技术部实例授权给技术部（部门级）
  // 注：EmployeeGrant 的唯一约束含 nullable 字段（memberId），
  // Prisma upsert 不允许 where 条件里有 null，改用 createMany skipDuplicates。
  await prisma.employeeGrant.createMany({
    data: [
      { instanceId: 'demo-inst-copy-tech', departmentId: 'demo-dept-tech' },
    ],
    skipDuplicates: true,
  });

  return { globexInstance };
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding demo data (P0 企业组织版)...');

  const users = await seedUsers();
  const ents = await seedEnterprises(users);
  const caps = await seedCapabilities(users.platformAdmin.id);
  const tpls = await seedTemplates(caps);
  await seedSubscriptionsAndInstances(ents, tpls);

  console.log('✅ Seed done. 密码统一 Demo123456');
  console.log('');
  console.log('  平台运营  admin@sep.local       不属于任何企业');
  console.log('  甲·管理员 boss@acme.local       示例科技（可订阅）');
  console.log('  甲·部门长 dev@acme.local        技术部');
  console.log('  甲·成员   staff@acme.local      技术部（只能用被授权的）');
  console.log('  乙·管理员 boss@globex.local     另一家公司（越权对照）');
  console.log('');
  console.log('  越权测试：用甲企业 token 访问 demo-inst-globex 必须失败');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

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
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

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

// ── 算力配额 ────────────────────────────────────────────────────────────────

async function seedComputeQuotas(ents: Awaited<ReturnType<typeof seedEnterprises>>) {
  // ACME 企业配额：FREE + STANDARD
  await prisma.computeQuota.upsert({
    where: { id: 'acme-quota-free' },
    update: {},
    create: {
      id: 'acme-quota-free',
      enterpriseId: ents.acme.id,
      type: 'FREE',
      totalTokens: 100000, // 10 万 tokens 免费配额
      usedTokens: 0,
      priority: 0, // 最高优先级，优先消耗
      expiresAt: null, // 永久有效
      status: 'ACTIVE',
    },
  });

  await prisma.computeQuota.upsert({
    where: { id: 'acme-quota-standard' },
    update: {},
    create: {
      id: 'acme-quota-standard',
      enterpriseId: ents.acme.id,
      type: 'STANDARD',
      totalTokens: 1000000, // 100 万 tokens 标准配额
      usedTokens: 0,
      priority: 1, // 次优先级，免费用完后消耗
      expiresAt: null, // 永久有效
      status: 'ACTIVE',
    },
  });

  // Globex 企业配额：FREE
  await prisma.computeQuota.upsert({
    where: { id: 'globex-quota-free' },
    update: {},
    create: {
      id: 'globex-quota-free',
      enterpriseId: ents.globex.id,
      type: 'FREE',
      totalTokens: 50000, // 5 万 tokens 免费配额
      usedTokens: 0,
      priority: 0,
      expiresAt: null,
      status: 'ACTIVE',
    },
  });

  // ── 三级配额体系 (UserQuota + SubscriptionQuota) ──────────────────────────
  // Priority: 0 = UserQuota (碳基员工个人配额，优先扣)
  //          1 = SubscriptionQuota (硅基员工订阅配额)
  //          2 = ComputeQuota (企业池，兜底)

  // ACME 企业的 UserQuota（碳基员工个人配额）
  await prisma.userQuota.upsert({
    where: { id: 'acme-user-quota-boss' },
    update: {},
    create: {
      id: 'acme-user-quota-boss',
      userId: ents.bossMember.userId,
      enterpriseId: ents.acme.id,
      totalTokens: 50000,
      usedTokens: 0,
      status: 'ACTIVE',
      allocatedBy: ents.bossMember.userId, // 自己给自己分配
      notes: '企业管理员个人配额',
    },
  });

  await prisma.userQuota.upsert({
    where: { id: 'acme-user-quota-staff' },
    update: {},
    create: {
      id: 'acme-user-quota-staff',
      userId: ents.staffMember.userId,
      enterpriseId: ents.acme.id,
      totalTokens: 30000,
      usedTokens: 0,
      status: 'ACTIVE',
      allocatedBy: ents.bossMember.userId,
      notes: '普通员工个人配额',
    },
  });

  // Globex 企业的 UserQuota
  // 注意：seedEnterprises 没有返回 globex 的 boss member，需要查询
  const globexBossMember = await prisma.enterpriseMember.findFirst({
    where: { enterpriseId: ents.globex.id, role: 'ENTERPRISE_ADMIN' as any },
  });
  if (globexBossMember) {
    await prisma.userQuota.upsert({
      where: { id: 'globex-user-quota-boss' },
      update: {},
      create: {
        id: 'globex-user-quota-boss',
        userId: globexBossMember.userId,
        enterpriseId: ents.globex.id,
        totalTokens: 20000,
        usedTokens: 0,
        status: 'ACTIVE',
        allocatedBy: globexBossMember.userId,
        notes: '企业管理员个人配额',
      },
    });
  }
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

  // 模板 2：用于演示「一个企业雇佣多名员工」
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

// ── 雇佣关系与授权 ──────────────────────────────────────────────────────────

/**
 * 雇佣关系（Subscription）+ 授权（EmployeeGrant）。
 *
 * 收敛后不再有 EmployeeInstance：一企业一员工只有一段雇佣关系，
 * 「同一员工在不同部门各来一份」由多条 EmployeeGrant 的 departmentId 表达。
 */
async function seedSubscriptionsAndGrants(
  ents: Awaited<ReturnType<typeof seedEnterprises>>,
  tpls: Awaited<ReturnType<typeof seedTemplates>>,
) {
  // 甲企业雇佣两个员工。
  // 注：id 用 create 里的字面量不可靠 —— 反复 seed 时命中 update 分支，
  // 老行仍是自动 cuid。这里取 upsert 的返回值，两种情况都对。
  const acmeSubs: Record<string, string> = {};
  for (const [emp, id] of [
    [tpls.skillsEmp, 'demo-sub-acme-copy'],
    [tpls.researchEmp, 'demo-sub-acme-research'],
  ] as const) {
    const sub = await prisma.subscription.upsert({
      where: {
        enterpriseId_employeeId: {
          enterpriseId: ents.acme.id,
          employeeId: emp.id,
        },
      },
      update: { status: 'ACTIVE' as any },
      create: {
        id,
        enterpriseId: ents.acme.id,
        employeeId: emp.id,
        status: 'ACTIVE' as any,
        // 雇佣时锁定的版本：模板发新版只提示，不自动跟进
        templateVersion: '1.0.0',
      },
    });
    acmeSubs[emp.id] = sub.id;

    // 为每个订阅创建配额（硅基员工自带配额，priority=1）
    await prisma.subscriptionQuota.upsert({
      where: { subscriptionId: sub.id },
      update: {},
      create: {
        subscriptionId: sub.id,
        enterpriseId: ents.acme.id,
        totalTokens: 100000, // 每个订阅 10 万 tokens
        usedTokens: 0,
        status: 'ACTIVE',
      },
    });
  }

  // 乙企业也雇佣同一员工 —— 用于验证雇佣关系不会跨企业泄漏
  const globexSub = await prisma.subscription.upsert({
    where: {
      enterpriseId_employeeId: {
        enterpriseId: ents.globex.id,
        employeeId: tpls.skillsEmp.id,
      },
    },
    update: { status: 'ACTIVE' as any },
    create: {
      id: 'demo-sub-globex-copy',
      enterpriseId: ents.globex.id,
      employeeId: tpls.skillsEmp.id,
      status: 'ACTIVE' as any,
      templateVersion: '1.0.0',
      name: '乙企业文案助手',
    },
  });

  // 为 Globex 订阅创建配额
  await prisma.subscriptionQuota.upsert({
    where: { subscriptionId: globexSub.id },
    update: {},
    create: {
      subscriptionId: globexSub.id,
      enterpriseId: ents.globex.id,
      totalTokens: 80000, // Globex 订阅 8 万 tokens
      usedTokens: 0,
      status: 'ACTIVE',
    },
  });

  // 授权：文案助手同时授给技术部和运营部。
  // 收敛前这里是「同一模板开两个实例，各挂一个部门」，现在是
  // 同一段雇佣关系下两条部门授权 —— 部门差异化落在授权记录上。
  //
  // 注：EmployeeGrant 的唯一约束是两个部分唯一索引（含 NULL 列），
  // Prisma upsert 的 where 不接受 null，故用 createMany skipDuplicates。
  const copySubId = acmeSubs[tpls.skillsEmp.id];
  await prisma.employeeGrant.createMany({
    data: [
      { subscriptionId: copySubId, departmentId: ents.techDept.id },
      { subscriptionId: copySubId, departmentId: ents.opsDept.id },
    ],
    skipDuplicates: true,
  });

  return { globexSub };
}

// ── 员工包（下载演示数据）──────────────────────────────────────────────────

async function seedEmployeePackages(
  tpls: Awaited<ReturnType<typeof seedTemplates>>,
  platformAdminId: string,
) {
  const storageRoot = path.resolve(__dirname, '../storage/packages');
  if (!fs.existsSync(storageRoot)) {
    fs.mkdirSync(storageRoot, { recursive: true });
  }

  // 为每个已发布的员工生成演示 ZIP
  for (const emp of [tpls.skillsEmp, tpls.researchEmp]) {
    const empDir = path.join(storageRoot, emp.id);
    if (!fs.existsSync(empDir)) {
      fs.mkdirSync(empDir, { recursive: true });
    }

    const zipPath = path.join(empDir, `${emp.id}-v${emp.version}.zip`);
    const relPath = path.relative(storageRoot, zipPath);

    // 已存在则跳过
    if (fs.existsSync(zipPath)) {
      console.log(`  ⏭️  Package already exists: ${relPath}`);
      continue;
    }

    // 创建 ZIP（使用 adm-zip）
    const zip = new AdmZip();

    // README.txt
    const readme = `# ${emp.name} v${emp.version}

## 描述
${emp.description}

## 适用场景
行业: ${emp.industry}
职位: ${emp.position}

## 使用说明
1. 解压本包到你的项目目录
2. 参考 config.json 配置模型参数
3. 将 skills/ 目录拷贝到你的 AI agent 工作区

---
由硅基人才平台生成 | ${new Date().toISOString()}
`;

    // config.json
    const config = {
      name: emp.name,
      version: emp.version,
      modelId: emp.modelId,
      maxSteps: emp.maxSteps,
      systemPrompt: emp.systemPrompt,
      capabilityCount: 0,
    };

    zip.addFile('README.txt', Buffer.from(readme, 'utf8'));
    zip.addFile('config.json', Buffer.from(JSON.stringify(config, null, 2), 'utf8'));
    zip.writeZip(zipPath);

    console.log(`  ✅ Generated package: ${relPath}`);

    // 插入 EmployeePackage 记录
    await prisma.employeePackage.upsert({
      where: { id: emp.id },
      update: { storagePath: relPath, version: emp.version },
      create: {
        id: emp.id,
        version: emp.version,
        storagePath: relPath,
        fileSizeBytes: fs.statSync(zipPath).size,
        uploadedBy: platformAdminId,
        employee: {
          connect: { id: emp.id },
        },
      },
    });
  }

  console.log('');
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding demo data (P0 企业组织版)...');

  const users = await seedUsers();
  const ents = await seedEnterprises(users);
  await seedComputeQuotas(ents);
  const caps = await seedCapabilities(users.platformAdmin.id);
  const tpls = await seedTemplates(caps);
  await seedSubscriptionsAndGrants(ents, tpls);
  await seedEmployeePackages(tpls, users.platformAdmin.id);

  // 初始化系统配置
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

  console.log('\n✅ Seed done. 密码统一 Demo123456');
  console.log('');
  console.log('  平台运营  admin@sep.local       不属于任何企业');
  console.log('  甲·管理员 boss@acme.local       示例科技（可订阅）');
  console.log('  甲·部门长 dev@acme.local        技术部');
  console.log('  甲·成员   staff@acme.local      技术部（只能用被授权的）');
  console.log('  乙·管理员 boss@globex.local     另一家公司（越权对照）');
  console.log('');
  console.log('  越权测试：用甲企业 token 访问 demo-sub-globex-copy 必须失败');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

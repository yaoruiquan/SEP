/**
 * 账号：用户 / 企业 / 部门 / 成员。
 *
 * 为什么造**两家**企业：单企业数据无法暴露多租户越权 —— 所有查询即使漏掉
 * enterpriseId 过滤也一样返回正确结果。有了第二家，越权测试才有对照物：
 * 拿甲方 token 去查乙方资源，必须失败。
 *
 * 密码统一 Demo123456，bcrypt cost 10（与 auth.service.ts 的 hash 一致）。
 */
import { PrismaClient, EnterpriseRole, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export const DEMO_PASSWORD = 'Demo123456';

/**
 * 默认部门树，与 DefaultDepartmentsService.DEFAULT_TREE 保持一致。
 *
 * 为什么复制而不是 import 那个 service：它是 @Injectable，拿来用就得在
 * 脚本里起 Nest 容器。种子脚本直连 Prisma 是有意的 —— 但这份复制品有
 * 漂移风险，改默认部门树时两处都要动。
 */
export const DEPARTMENT_TREE: Array<{ name: string; groups: string[] }> = [
  { name: '技术部', groups: ['研发组', '测试组', '运维组'] },
  { name: '产品部', groups: ['设计组', '产品经理组'] },
  { name: '市场部', groups: ['品牌组', '增长组'] },
  { name: '销售部', groups: ['直销组', '渠道组'] },
  { name: '客户服务部', groups: ['技术支持组', '客户成功组'] },
];

export interface SeededAccounts {
  platformAdmin: { id: string; email: string };
  acme: { id: string; name: string };
  globex: { id: string; name: string };
  /** 部门名 → id，供后续模块（授权、知识库）引用 */
  acmeDepartments: Map<string, string>;
  members: {
    acmeBoss: { id: string; userId: string };
    acmeDev: { id: string; userId: string };
    acmeStaff: { id: string; userId: string };
    globexBoss: { id: string; userId: string };
  };
}

export async function seedAccounts(
  prisma: PrismaClient,
): Promise<SeededAccounts> {
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);

  const mkUser = (email: string, name: string, role: UserRole) =>
    prisma.user.upsert({
      where: { email },
      update: { name, role, password },
      create: { email, name, role, password },
    });

  // 平台运营。UserRole.ADMIN 只表示「平台运营人员」（可进 (platform) 分组），
  // 企业内角色一律看 EnterpriseMember.role —— 两套体系，别混。
  // 他不属于任何企业，这是有意的：验证平台视角不依赖企业上下文。
  const platformAdmin = await mkUser('admin@sep.local', '平台运营', 'ADMIN');

  const acmeBossUser = await mkUser('boss@acme.local', '甲总', 'USER');
  const acmeDevUser = await mkUser('dev@acme.local', '技术负责人', 'USER');
  const acmeStaffUser = await mkUser('staff@acme.local', '技术员', 'USER');
  const globexBossUser = await mkUser('boss@globex.local', '乙总', 'USER');

  // ── 企业 ──────────────────────────────────────────────────────────────
  // 固定 id：后续模块要引用，且便于手写越权测试用例。
  const acme = await prisma.enterprise.upsert({
    where: { id: 'demo-ent-acme' },
    update: {},
    create: {
      id: 'demo-ent-acme',
      name: '示例科技有限公司',
      description: '演示用企业，含完整部门与成员结构',
    },
  });

  const globex = await prisma.enterprise.upsert({
    where: { id: 'demo-ent-globex' },
    update: {},
    create: {
      id: 'demo-ent-globex',
      name: '另一家公司',
      description: '越权测试对照企业 —— 甲企业账号不得访问本企业任何数据',
    },
  });

  // ── 部门（仅甲企业铺完整树，乙企业从简）──────────────────────────────
  // Department 没有 (enterpriseId, name) 唯一约束，upsert 无从下手。
  // 故：已有部门就整树跳过，重读现有的 —— 与 DefaultDepartmentsService
  // 的幂等策略一致（不追加、不覆盖，避免把管理员改过的架构搞乱）。
  const acmeDepartments = new Map<string, string>();
  const existingDepts = await prisma.department.findMany({
    where: { enterpriseId: acme.id },
    select: { id: true, name: true },
  });

  if (existingDepts.length > 0) {
    for (const d of existingDepts) acmeDepartments.set(d.name, d.id);
  } else {
    for (const [deptIndex, dept] of DEPARTMENT_TREE.entries()) {
      const created = await prisma.department.create({
        data: {
          enterpriseId: acme.id,
          name: dept.name,
          sortOrder: deptIndex,
          children: {
            create: dept.groups.map((g, i) => ({
              enterpriseId: acme.id,
              name: g,
              sortOrder: i,
            })),
          },
        },
        include: { children: true },
      });
      acmeDepartments.set(created.name, created.id);
      for (const child of created.children) {
        acmeDepartments.set(child.name, child.id);
      }
    }
  }

  const techDeptId = acmeDepartments.get('技术部')!;

  // ── 成员 ──────────────────────────────────────────────────────────────
  // 三种企业内角色各一，构成权限矩阵的最小验证集。
  const mkMember = (
    userId: string,
    enterpriseId: string,
    role: EnterpriseRole,
    departmentId?: string,
    position?: string,
  ) =>
    prisma.enterpriseMember.upsert({
      where: { userId_enterpriseId: { userId, enterpriseId } },
      update: { role, departmentId: departmentId ?? null, position },
      create: { userId, enterpriseId, role, departmentId, position },
    });

  const acmeBoss = await mkMember(
    acmeBossUser.id,
    acme.id,
    'ENTERPRISE_ADMIN',
    undefined,
    '总经理',
  );
  const acmeDev = await mkMember(
    acmeDevUser.id,
    acme.id,
    'DEPT_MANAGER',
    techDeptId,
    '技术总监',
  );
  const acmeStaff = await mkMember(
    acmeStaffUser.id,
    acme.id,
    'MEMBER',
    acmeDepartments.get('研发组')!,
    '后端工程师',
  );
  const globexBoss = await mkMember(
    globexBossUser.id,
    globex.id,
    'ENTERPRISE_ADMIN',
  );

  // 部门主管：技术部挂给 DEPT_MANAGER。
  // 必须在 member 建好之后 —— leaderId 指向 EnterpriseMember 而非 User。
  await prisma.department.update({
    where: { id: techDeptId },
    data: { leaderId: acmeDev.id },
  });

  // ── 钱包与算力账户 ────────────────────────────────────────────────────
  // 两者都建：ComputeAccount.balance 已废弃（真实余额在 EnterpriseWallet），
  // 但仍有代码路径按 enterpriseId 查它，缺了会报错。
  for (const ent of [acme, globex]) {
    await prisma.enterpriseWallet.upsert({
      where: { enterpriseId: ent.id },
      update: {},
      create: { enterpriseId: ent.id },
    });
    await prisma.computeAccount.upsert({
      where: { enterpriseId: ent.id },
      update: {},
      create: { enterpriseId: ent.id },
    });
  }

  return {
    platformAdmin: { id: platformAdmin.id, email: platformAdmin.email },
    acme: { id: acme.id, name: acme.name },
    globex: { id: globex.id, name: globex.name },
    acmeDepartments,
    members: {
      acmeBoss: { id: acmeBoss.id, userId: acmeBoss.userId },
      acmeDev: { id: acmeDev.id, userId: acmeDev.userId },
      acmeStaff: { id: acmeStaff.id, userId: acmeStaff.userId },
      globexBoss: { id: globexBoss.id, userId: globexBoss.userId },
    },
  };
}

/**
 * 常州数易网络科技有限公司 —— 演示租户的账号与组织。
 *
 * 为什么另起一家而不是改 demo-ent-acme：示例科技被 03-demo-usage、
 * 07-dashboard-analytics、invitation.service.spec 等多处按固定 id 和
 * 固定邮箱引用，改名会让那些引用变成"名字对不上的历史包袱"。
 * 新建一家真名租户，示例科技原样留着当回归基线。
 *
 * 幂等：企业按固定 id upsert，用户按邮箱 upsert，成员按
 * (userId, enterpriseId) upsert，部门整树跳过（同 01-accounts 的策略）。
 */
import { PrismaClient, EnterpriseRole, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEMO_PASSWORD, DEPARTMENT_TREE } from './01-accounts';

/** 固定 id：下游演示数据要引用，也便于手写多租户越权用例。 */
export const SHUYI_ENTERPRISE_ID = 'demo-ent-shuyi';
export const SHUYI_ENTERPRISE_NAME = '常州数易网络科技有限公司';

/**
 * 五个人。角色刻意铺满三档（管理员 / 部门负责人 / 普通成员）——
 * 演示"角色权限"和"授权"两页时需要有差异对照，全员管理员看不出区别。
 *
 * ⚠️ DEPT_MANAGER 目前在后端与 MEMBER 权限等同（见
 * EnterpriseContextService.assertCanApprove 的注释），这里只体现组织身份。
 */
export interface ShuyiPerson {
  email: string;
  name: string;
  role: EnterpriseRole;
  /** 部门名，取自 DEPARTMENT_TREE；null = 不挂部门（管理层） */
  department: string | null;
  position: string;
  /** 该部门的负责人（写入 Department.leaderId） */
  leadsDepartment?: string;
}

export const SHUYI_PEOPLE: ShuyiPerson[] = [
  {
    email: 'liuling@shuyi.local',
    name: '刘凌',
    role: 'ENTERPRISE_ADMIN',
    department: null,
    position: '总经理',
  },
  {
    email: 'yaoruiquan@shuyi.local',
    name: '姚瑞泉',
    role: 'DEPT_MANAGER',
    department: '技术部',
    position: '技术总监',
    leadsDepartment: '技术部',
  },
  {
    email: 'hurui@shuyi.local',
    name: '胡锐',
    role: 'MEMBER',
    department: '研发组',
    position: '后端工程师',
  },
  {
    email: 'liulingfang@shuyi.local',
    name: '刘凌芳',
    role: 'DEPT_MANAGER',
    department: '市场部',
    position: '市场经理',
    leadsDepartment: '市场部',
  },
  {
    email: 'lijiayang@shuyi.local',
    name: '李佳阳',
    role: 'MEMBER',
    department: '产品经理组',
    position: '产品经理',
  },
];

export interface SeededShuyi {
  enterprise: { id: string; name: string };
  /** 部门名 → id */
  departments: Map<string, string>;
  /** 邮箱 → { memberId, userId, name } */
  members: Map<string, { id: string; userId: string; name: string }>;
  /** 企业管理员的 EnterpriseMember.id —— 履约订阅时要挂在他名下 */
  adminMemberId: string;
}

export async function seedShuyiAccounts(
  prisma: PrismaClient,
): Promise<SeededShuyi> {
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── 企业 ────────────────────────────────────────────────────────────────
  const enterprise = await prisma.enterprise.upsert({
    where: { id: SHUYI_ENTERPRISE_ID },
    // update 带上 name：后台没有改名接口，改这里重跑 seed 是唯一入口。
    update: { name: SHUYI_ENTERPRISE_NAME },
    create: {
      id: SHUYI_ENTERPRISE_ID,
      name: SHUYI_ENTERPRISE_NAME,
      description: '数易网络科技 —— 演示租户，含完整组织架构、雇佣关系与用量数据',
    },
  });

  // ── 部门树 ──────────────────────────────────────────────────────────────
  // Department 没有 (enterpriseId, name) 唯一约束，无从 upsert；
  // 已有部门就整树跳过并重读，避免把手工调整过的架构覆盖掉。
  const departments = new Map<string, string>();
  const existing = await prisma.department.findMany({
    where: { enterpriseId: enterprise.id },
    select: { id: true, name: true },
  });

  if (existing.length > 0) {
    for (const d of existing) departments.set(d.name, d.id);
  } else {
    for (const [i, dept] of DEPARTMENT_TREE.entries()) {
      const created = await prisma.department.create({
        data: {
          enterpriseId: enterprise.id,
          name: dept.name,
          sortOrder: i,
          children: {
            create: dept.groups.map((g, j) => ({
              enterpriseId: enterprise.id,
              name: g,
              sortOrder: j,
            })),
          },
        },
        include: { children: true },
      });
      departments.set(created.name, created.id);
      for (const child of created.children) {
        departments.set(child.name, child.id);
      }
    }
  }

  // ── 用户 + 成员 ─────────────────────────────────────────────────────────
  const members = new Map<string, { id: string; userId: string; name: string }>();

  for (const person of SHUYI_PEOPLE) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, password, role: UserRole.USER },
      create: {
        email: person.email,
        name: person.name,
        password,
        role: UserRole.USER,
      },
    });

    const departmentId = person.department
      ? (departments.get(person.department) ?? null)
      : null;

    if (person.department && !departmentId) {
      throw new Error(
        `部门「${person.department}」不在 DEPARTMENT_TREE 中，${person.name} 无处安置`,
      );
    }

    const member = await prisma.enterpriseMember.upsert({
      where: {
        userId_enterpriseId: { userId: user.id, enterpriseId: enterprise.id },
      },
      update: { role: person.role, departmentId, position: person.position },
      create: {
        userId: user.id,
        enterpriseId: enterprise.id,
        role: person.role,
        departmentId,
        position: person.position,
      },
    });

    members.set(person.email, {
      id: member.id,
      userId: user.id,
      name: person.name,
    });
  }

  // ── 部门负责人 ──────────────────────────────────────────────────────────
  // 必须在 member 建好之后：leaderId 指向 EnterpriseMember 而非 User。
  for (const person of SHUYI_PEOPLE) {
    if (!person.leadsDepartment) continue;
    const deptId = departments.get(person.leadsDepartment);
    const member = members.get(person.email);
    if (!deptId || !member) continue;
    await prisma.department.update({
      where: { id: deptId },
      data: { leaderId: member.id },
    });
  }

  // ── 钱包与算力账户 ──────────────────────────────────────────────────────
  // 两者都建：ComputeAccount.balance 已废弃（真实余额在 EnterpriseWallet），
  // 但 RechargeOrder / ComputeTransaction 的外键仍指向它，缺了会报错。
  await prisma.enterpriseWallet.upsert({
    where: { enterpriseId: enterprise.id },
    update: {},
    create: { enterpriseId: enterprise.id },
  });
  await prisma.computeAccount.upsert({
    where: { enterpriseId: enterprise.id },
    update: {},
    create: { enterpriseId: enterprise.id, balance: 0 },
  });

  const admin = SHUYI_PEOPLE.find((p) => p.role === 'ENTERPRISE_ADMIN')!;

  return {
    enterprise: { id: enterprise.id, name: enterprise.name },
    departments,
    members,
    adminMemberId: members.get(admin.email)!.id,
  };
}

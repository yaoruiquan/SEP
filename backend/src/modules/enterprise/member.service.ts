import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";
import { MemberCreateDto, MemberUpdateDto } from "shared";
import { EnterpriseContextService } from "./enterprise-context.service";

@Injectable()
export class MemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
  ) {}

  /** 列出本企业成员。可按部门过滤。 */
  async list(userId: string, departmentId?: string) {
    const ctx = await this.ctx.resolve(userId);

    return this.prisma.enterpriseMember.findMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        ...(departmentId && { departmentId }),
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        position: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true, avatar: true } },
        department: {
          select: {
            id: true,
            name: true,
            parent: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * 添加成员 —— 第二个人进入企业的**唯一途径**。
   *
   * 注册入口只用于「开公司」；同事若走注册会创建出另一家公司，
   * 与本企业数据完全隔离。
   *
   * MVP 采用「管理员代建账号 + 设初始密码」，不做邮件邀请
   * （邮件服务未接入）。因此这里会创建 User。
   *
   * 一个已存在的 User（如已在别家企业）也可被加入本企业：
   * EnterpriseMember 是关联表，天然支持。但 MVP 前端不做企业切换，
   * 该用户登录后只会看到最早加入的那家 —— 故此处拒绝，避免产生
   * 用户无法访问的"隐形成员"。
   */
  async create(userId: string, dto: MemberCreateDto) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    if (dto.departmentId) {
      await this.assertDepartmentInEnterprise(dto.departmentId, ctx.enterpriseId);
    }

    // 邮箱大小写不敏感 —— 不归一化会让 "Bob@x.com" 绕过"已是成员"检查，
    // 建出同一个人的第二条成员记录
    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, memberships: { select: { enterpriseId: true } } },
    });

    // ── 三分支：邮箱已注册时的处置 ────────────────────────────────────────
    if (existingUser) {
      // ① 已是本企业成员 —— 重复添加无意义
      if (
        existingUser.memberships.some(
          (m) => m.enterpriseId === ctx.enterpriseId,
        )
      ) {
        throw new ConflictException("该邮箱已是本企业成员");
      }

      // ② 已注册但无企业归属 —— 允许直接加入。
      //
      // 这是「离职后重新入职」「被移出后再加回」的必经路径：
      // 账号还在，只是没有归属。旧实现在此处硬拒绝，导致这些人
      // 永远无法再进入任何企业（邮箱被占，又不能加入）。
      //
      // 关键：**绝不动这个账号的密码**。dto.password 在此分支被忽略 ——
      // 若允许覆盖，任一企业管理员只需"添加"某个已知邮箱并设密码，
      // 就能登入他人账号，这是账号劫持。密码只能由账号本人设置。
      if (existingUser.memberships.length === 0) {
        const member = await this.prisma.enterpriseMember.create({
          data: {
            userId: existingUser.id,
            enterpriseId: ctx.enterpriseId,
            role: dto.role,
            departmentId: dto.departmentId,
            position: dto.position,
          },
          select: {
            id: true,
            role: true,
            position: true,
            user: { select: { id: true, email: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        });

        return {
          ...member,
          /**
           * 告知前端：该账号本就存在，沿用其原有密码，管理员填的密码未生效。
           * 不返回这个标记，管理员会把自己填的密码转告对方，导致登录失败。
           */
          reusedExistingAccount: true,
        };
      }

      // ③ 已归属其他企业 —— 拒绝，但给出可操作的下一步。
      //
      // EnterpriseMember 是关联表，技术上支持一人属多企业；但前端不做
      // 企业切换，该用户登录后只会看到最早加入的那家 —— 直接放开会产生
      // 用户自己看不见的"隐形成员"。故要求其先主动退出原企业。
      throw new ConflictException(
        "该邮箱已归属其他企业。请让对方先在个人设置中退出当前企业，" +
          "再向其发送邀请链接加入本企业",
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    // User 与 EnterpriseMember 必须同时成功：
    // 只建 User 会留下"有账号但不属于任何企业"的死账号
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          password: passwordHash,
        },
      });

      return tx.enterpriseMember.create({
        data: {
          userId: user.id,
          enterpriseId: ctx.enterpriseId,
          role: dto.role,
          departmentId: dto.departmentId,
          position: dto.position,
        },
        select: {
          id: true,
          role: true,
          position: true,
          user: { select: { id: true, email: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      });
    });
  }

  /** 修改成员角色 / 调岗。 */
  async update(userId: string, memberId: string, dto: MemberUpdateDto) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    const member = await this.assertMemberInEnterprise(
      memberId,
      ctx.enterpriseId,
    );

    if (dto.departmentId) {
      await this.assertDepartmentInEnterprise(dto.departmentId, ctx.enterpriseId);
    }

    // 不允许把自己降级 —— 否则管理员可一步操作把自己锁在门外
    if (
      member.id === ctx.memberId &&
      dto.role !== undefined &&
      dto.role !== "ENTERPRISE_ADMIN"
    ) {
      throw new BadRequestException(
        "不能降低自己的角色，请由另一位企业管理员操作",
      );
    }

    if (dto.role !== undefined && dto.role !== "ENTERPRISE_ADMIN") {
      await this.assertNotLastAdmin(member, ctx.enterpriseId);
    }

    return this.prisma.enterpriseMember.update({
      where: { id: memberId },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.departmentId !== undefined && {
          departmentId: dto.departmentId,
        }),
        ...(dto.position !== undefined && { position: dto.position }),
      },
      select: {
        id: true,
        role: true,
        position: true,
        user: { select: { id: true, email: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * 移出企业（离职）。
   *
   * 分界线是「个人持有的东西」与「企业侧的沉淀」：
   *
   *   回收（跟人走的授权，必须立即失效）
   *     · EmployeeGrant 中 memberId = 本人的记录 —— 个人席位
   *     · PENDING 的 AccessRequest —— 非成员的申请无从批准，置为 CANCELED
   *     · 其所主管的部门 —— leaderId 置空，并在响应里报出待重新指派
   *
   *   保留（留在企业，这正是会议强调的"员工走了，东西全部沉淀在我这里"）
   *     · 已审批的 AccessRequest 及审批结论 —— 审计链
   *     · 知识库、文档、技能覆写 —— 挂在 Enterprise 上，与成员身份无关
   *     · 会话与工作记录 —— 挂在 User 上，User 不删
   *
   * 为什么硬删 EnterpriseMember 而不是标记 LEFT：
   * 软删要求每个读路径都记得过滤 status，漏一处就是"已离职的人还能用"。
   * 最危险的是 EnterpriseContextService.resolve() —— 那里漏过滤等于权限失效。
   * 且 @@unique([userId, enterpriseId]) 会让残留行挡住此人日后重新入职。
   * 身份用硬删（边界清晰），沉淀靠 SetNull + 快照保住，比软删更难出错。
   *
   * 注意 User 一律保留：他可能还属于别家企业，且离职后应能凭原账号
   * 接受新邀请（见 create 的分支②）。
   */
  async remove(userId: string, memberId: string) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    const member = await this.loadForOffboard(memberId);
    // 越权返回 404，不泄漏该 id 是否存在
    if (!member || member.enterpriseId !== ctx.enterpriseId) {
      throw new NotFoundException(`成员 ${memberId} 不存在`);
    }

    if (member.id === ctx.memberId) {
      throw new BadRequestException("不能移除自己");
    }
    await this.assertNotLastAdmin(member, ctx.enterpriseId);

    return this.offboard(member);
  }

  /**
   * 主动离职。
   *
   * 存在的意义是给「原公司已经不管这事了」兜底 —— 若只有管理员移除
   * 这一个入口，一个人的账号会被前雇主的不作为永久卡住，既进不了新企业
   * 也用不了原企业。
   *
   * MVP 不走审批：需要原企业同意才能离职，等于把上面那个死锁又搬回来了。
   * 回收的东西全在企业侧（席位、部门归属），离职不带走任何数据，
   * 所以无需审批也不会造成企业损失。
   *
   * 处置逻辑与管理员移除**完全共用** offboard()，不另写一套 ——
   * 两套回收逻辑迟早漂移，届时一个入口回收席位、另一个漏掉，
   * 会留下已离职却仍占着授权的幽灵成员。
   */
  async leaveEnterprise(userId: string) {
    // 这里必须用 resolveOrNull：resolve() 对无归属用户抛 403，
    // 会把"你本来就没有企业"报成"你无权操作"，让人无从下手。
    const ctx = await this.ctx.resolveOrNull(userId);
    if (!ctx) {
      throw new BadRequestException("你当前未归属任何企业");
    }

    const member = await this.loadForOffboard(ctx.memberId);
    if (!member) {
      throw new NotFoundException("成员记录不存在");
    }

    // 唯一管理员不得离职：走掉之后企业永久失去管理能力，
    // 没人能加成员、建部门、订阅，也没人能把自己提回管理员。
    // 与 remove() 的约束保持一致，只是措辞针对"本人主动"。
    await this.assertNotLastAdmin(
      member,
      ctx.enterpriseId,
      "你是本企业唯一的管理员，请先指定其他管理员，再办理离职",
    );

    const result = await this.offboard(member);
    return {
      ...result,
      enterprise: { id: member.enterprise.id, name: member.enterprise.name },
    };
  }

  // ── 离职处置（管理员移除与主动离职共用）────────────────────────────────

  private async loadForOffboard(memberId: string) {
    return this.prisma.enterpriseMember.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        enterpriseId: true,
        role: true,
        user: { select: { id: true, email: true, name: true } },
        enterprise: { select: { id: true, name: true } },
        ledDepartments: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * 执行离职处置。调用方负责鉴权与前置校验，这里只管数据处置。
   *
   * 全程单事务：半途失败若已提交，会留下"授权已回收、人还在企业"
   * 这种谁都看不出问题的中间态。
   */
  private async offboard(member: {
    id: string;
    user: { email: string; name: string | null };
    ledDepartments: { id: string; name: string }[];
  }) {
    const memberId = member.id;

    return this.prisma.$transaction(async (tx) => {
      // 身份快照必须在删除**之前**写入：删除后 requesterId 已被
      // SetNull 置空，再也定位不到这些行是谁的。
      await tx.accessRequest.updateMany({
        where: { requesterId: memberId },
        data: {
          requesterEmail: member.user.email,
          requesterName: member.user.name,
        },
      });

      // 待审批的申请随人一起终结 —— 留着会让审批人批出一条
      // memberId 为空的悬空授权。
      const canceled = await tx.accessRequest.updateMany({
        where: { requesterId: memberId, status: "PENDING" },
        data: { status: "CANCELED" },
      });

      // 只回收授权给「本人」的席位。
      // 授权给部门的记录（departmentId 非空、memberId 为空）不动 ——
      // 那属于部门，不随离职人员消失。
      const reclaimed = await tx.employeeGrant.deleteMany({
        where: { memberId },
      });

      // leaderId 是 SetNull，删除时数据库会自动置空。
      // 这里不重复置空，只把名单带进响应 —— 部门无主是需要管理员
      // 补动作的状态，静默处理会留下没人负责的部门。
      await tx.enterpriseMember.delete({ where: { id: memberId } });

      return {
        id: memberId,
        removed: true,
        reclaimedGrants: reclaimed.count,
        canceledRequests: canceled.count,
        vacatedDepartments: member.ledDepartments,
      };
    });
  }

  // ── 内部校验 ──────────────────────────────────────────────────────────────

  private async assertMemberInEnterprise(id: string, enterpriseId: string) {
    const member = await this.prisma.enterpriseMember.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true, role: true },
    });
    // 越权返回 404，不泄漏该 id 是否存在
    if (!member || member.enterpriseId !== enterpriseId) {
      throw new NotFoundException(`成员 ${id} 不存在`);
    }
    return member;
  }

  private async assertDepartmentInEnterprise(
    id: string,
    enterpriseId: string,
  ) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true },
    });
    if (!dept || dept.enterpriseId !== enterpriseId) {
      throw new NotFoundException(`部门 ${id} 不存在`);
    }
  }

  /**
   * 保证企业至少留有一名管理员。
   *
   * 若允许移除/降级最后一位管理员，企业将永久失去管理能力：
   * 没人能加成员、建部门、订阅员工，也没人能把自己提回管理员 ——
   * 只能改数据库救回。
   */
  private async assertNotLastAdmin(
    member: { id: string; role: string },
    enterpriseId: string,
    message = "企业至少需要保留一名管理员，请先指定其他管理员",
  ) {
    if (member.role !== "ENTERPRISE_ADMIN") return;

    const adminCount = await this.prisma.enterpriseMember.count({
      where: { enterpriseId, role: "ENTERPRISE_ADMIN" },
    });
    if (adminCount <= 1) {
      throw new ConflictException(message);
    }
  }
}

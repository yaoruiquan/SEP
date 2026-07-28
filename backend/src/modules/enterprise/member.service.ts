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
        department: { select: { id: true, name: true } },
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

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, memberships: { select: { enterpriseId: true } } },
    });

    if (existingUser) {
      const already = existingUser.memberships.some(
        (m) => m.enterpriseId === ctx.enterpriseId,
      );
      if (already) {
        throw new ConflictException("该邮箱已是本企业成员");
      }
      // 已属于别家企业：MVP 单企业前提下加入会产生用户看不到的成员记录
      throw new ConflictException(
        "该邮箱已注册并归属其他企业，当前版本不支持跨企业加入",
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
   * 移出企业。
   *
   * 只删 EnterpriseMember，保留 User —— 该用户可能还属于别家企业，
   * 且历史数据（申请记录等）引用了他。
   */
  async remove(userId: string, memberId: string) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    const member = await this.assertMemberInEnterprise(
      memberId,
      ctx.enterpriseId,
    );

    if (member.id === ctx.memberId) {
      throw new BadRequestException("不能移除自己");
    }
    await this.assertNotLastAdmin(member, ctx.enterpriseId);

    await this.prisma.enterpriseMember.delete({ where: { id: memberId } });
    return { id: memberId, removed: true };
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
  ) {
    if (member.role !== "ENTERPRISE_ADMIN") return;

    const adminCount = await this.prisma.enterpriseMember.count({
      where: { enterpriseId, role: "ENTERPRISE_ADMIN" },
    });
    if (adminCount <= 1) {
      throw new ConflictException(
        "企业至少需要保留一名管理员，请先指定其他管理员",
      );
    }
  }
}

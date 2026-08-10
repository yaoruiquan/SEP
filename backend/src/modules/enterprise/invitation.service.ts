import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import {
  INVITATION_EXPIRES_DAYS,
  InvitationCreateDto,
  InvitationStatusValue,
} from "shared";
import { EnterpriseContextService } from "./enterprise-context.service";

/** 邀请 token 字节数。32 字节 = 256 位 CSPRNG 熵，不可枚举。 */
const TOKEN_BYTES = 32;

@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
  ) {}

  /**
   * 生成邀请 token 的存储摘要。
   *
   * 用 SHA-256 而非 bcrypt，与 EnterpriseApiKey 的做法不同 ——
   * 校验邀请时只有 token、没有 email/企业上下文，必须能「由 token 直接定位记录」。
   * bcrypt 加盐后同一输入哈希不同，建不了唯一索引，只能全表扫描逐条 compare。
   * token 是 CSPRNG 随机值而非用户口令，无字典可猜，不需要慢哈希抗爆破。
   */
  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * 创建邀请，返回一次性明文 token。
   *
   * 明文只在本次响应里出现，库里只存摘要 —— 邀请链接等同于一次性登录凭证，
   * 明文入库意味着数据库泄露即可冒充任意被邀请人。
   *
   * MVP 不发邮件（邮件服务未接入），由管理员自行把链接转达给被邀请人。
   */
  async create(userId: string, dto: InvitationCreateDto) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    if (dto.departmentId) {
      await this.assertDepartmentInEnterprise(
        dto.departmentId,
        ctx.enterpriseId,
      );
    }

    const email = dto.email.toLowerCase().trim();

    // 已是本企业成员：邀请没有意义
    const existingMember = await this.prisma.enterpriseMember.findFirst({
      where: { enterpriseId: ctx.enterpriseId, user: { email } },
      select: { id: true },
    });
    if (existingMember) {
      throw new ConflictException("该邮箱已是本企业成员");
    }

    // 「同一企业同一邮箱最多一条 PENDING」是偏序约束，Prisma schema 表达不了
    // 部分唯一索引，故在此显式失效旧记录：重新邀请应让旧链接立即作废，
    // 否则同一人手上会有多条都能用的链接，撤回一条等于没撤。
    await this.prisma.enterpriseInvitation.updateMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        email,
        status: "PENDING",
      },
      data: { status: "REVOKED" },
    });

    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(
      Date.now() + INVITATION_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
    );

    const invitation = await this.prisma.enterpriseInvitation.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        email,
        tokenHash: this.hashToken(token),
        role: dto.role,
        departmentId: dto.departmentId ?? null,
        position: dto.position ?? null,
        expiresAt,
        invitedBy: userId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        position: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        department: { select: { id: true, name: true } },
      },
    });

    return {
      ...invitation,
      /** 明文 token，仅此一次返回。前端拼成 /join?token=xxx 交给管理员转达。 */
      token,
    };
  }

  /** 本企业邀请列表。可按状态过滤。顺带把已过期的 PENDING 收敛为 EXPIRED。 */
  async list(userId: string, status?: InvitationStatusValue) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    await this.expireStale(ctx.enterpriseId);

    return this.prisma.enterpriseInvitation.findMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        ...(status && { status }),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        position: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        acceptedAt: true,
        department: { select: { id: true, name: true } },
      },
    });
  }

  /** 撤回邀请。已接受的不可撤回 —— 成员关系已生成，应走移出企业。 */
  async revoke(userId: string, id: string) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    const invitation = await this.prisma.enterpriseInvitation.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true, status: true },
    });
    // 越权返回 404，不泄漏该 id 是否存在
    if (!invitation || invitation.enterpriseId !== ctx.enterpriseId) {
      throw new NotFoundException(`邀请 ${id} 不存在`);
    }
    if (invitation.status === "ACCEPTED") {
      throw new ConflictException(
        "该邀请已被接受，请到成员管理中移出该成员",
      );
    }
    if (invitation.status !== "PENDING") {
      throw new ConflictException("该邀请已失效，无需撤回");
    }

    await this.prisma.enterpriseInvitation.update({
      where: { id },
      data: { status: "REVOKED" },
    });

    return { success: true };
  }

  /**
   * 校验 token，返回邀请详情供受邀注册页展示（企业名、角色、部门）。
   *
   * 公开接口（无需登录）—— 被邀请人此时还没有账号。
   * 故只返回展示所需字段，不返回 email 之外的任何成员信息，
   * 避免 token 泄露时被用来探查企业组织结构。
   */
  async verifyToken(token: string) {
    const invitation = await this.prisma.enterpriseInvitation.findUnique({
      where: { tokenHash: this.hashToken(token) },
      select: {
        id: true,
        email: true,
        role: true,
        position: true,
        status: true,
        expiresAt: true,
        enterprise: { select: { id: true, name: true, logo: true } },
        department: { select: { id: true, name: true } },
      },
    });

    // 统一用 400 + 同一措辞，不区分「不存在」与「已失效」——
    // 区分会让攻击者能用响应差异枚举有效 token
    if (!invitation || invitation.status !== "PENDING") {
      throw new BadRequestException("邀请链接无效或已失效");
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      await this.prisma.enterpriseInvitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      throw new BadRequestException("邀请链接无效或已失效");
    }

    return invitation;
  }

  /**
   * 按 token 取出可用邀请的完整记录，供受邀注册流程内部使用。
   *
   * 与 verifyToken 的区别：这里返回写入 EnterpriseMember 所需的全部字段
   * （enterpriseId / departmentId / role），不做展示裁剪。
   */
  async findUsableByToken(token: string) {
    const invitation = await this.prisma.enterpriseInvitation.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!invitation || invitation.status !== "PENDING") {
      throw new BadRequestException("邀请链接无效或已失效");
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      await this.prisma.enterpriseInvitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      throw new BadRequestException("邀请链接无效或已失效");
    }

    return invitation;
  }

  /**
   * 已登录用户接受邀请，加入企业。
   *
   * 补上 registerByInvitation 的另一半：那条路径只服务「还没有账号」的人，
   * 已有账号者会被它拒绝并提示"请登录后再接受邀请" —— 指的就是这里。
   *
   * 不走企业上下文：接受者此刻很可能**无企业归属**，
   * EnterpriseContextService.resolve 会对其抛 403。
   */
  async acceptByUser(userId: string, token: string) {
    const invitation = await this.findUsableByToken(token);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        memberships: { select: { enterpriseId: true } },
      },
    });
    if (!user) throw new NotFoundException("用户不存在");

    // 邮箱绑定校验，与受邀注册同一理由：
    // 否则链接被转发后，任何登录用户都能用它加入企业
    if (user.email.toLowerCase() !== invitation.email) {
      throw new BadRequestException("该邀请不是发给当前登录账号的");
    }

    if (
      user.memberships.some((m) => m.enterpriseId === invitation.enterpriseId)
    ) {
      throw new ConflictException("你已是该企业成员");
    }

    // 已属别家企业：前端不做企业切换，加入会让你只看得到最早那家，
    // 本企业对你而言成了"看不见的归属"。要求先退出原企业。
    if (user.memberships.length > 0) {
      throw new ConflictException(
        "你已归属其他企业，请先在个人设置中退出当前企业，再接受本邀请",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.enterpriseMember.create({
        data: {
          userId: user.id,
          enterpriseId: invitation.enterpriseId,
          role: invitation.role,
          departmentId: invitation.departmentId,
          position: invitation.position,
        },
        select: {
          id: true,
          role: true,
          position: true,
          department: { select: { id: true, name: true } },
        },
      });

      // 条件更新 + count 校验：并发下只有一个请求能把 PENDING 改掉，
      // 另一个 count=0 → 抛错回滚，避免同一链接建出两个成员
      const claimed = await tx.enterpriseInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException("该邀请已被使用");
      }

      const enterprise = await tx.enterprise.findUniqueOrThrow({
        where: { id: invitation.enterpriseId },
        select: { id: true, name: true },
      });

      return { member, enterprise };
    });
  }

  /** 把过了期的 PENDING 收敛为 EXPIRED，让列表状态与实际一致。 */
  private async expireStale(enterpriseId: string) {
    await this.prisma.enterpriseInvitation.updateMany({
      where: {
        enterpriseId,
        status: "PENDING",
        expiresAt: { lte: new Date() },
      },
      data: { status: "EXPIRED" },
    });
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
}

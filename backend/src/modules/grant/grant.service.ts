import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EnterpriseContextService } from "../enterprise/enterprise-context.service";
import { PackageService } from "../digital-employee/package.service";
import { GrantCreateDto, GrantView, MyEmployeeView } from "shared";

@Injectable()
export class GrantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
    private readonly packages: PackageService,
  ) {}

  /**
   * 列出某雇佣关系的所有授权记录（管理员视角）。
   * 不过滤过期记录 —— 让管理员看到历史授权，前端标灰即可。
   */
  async listForSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<GrantView[]> {
    const context = await this.ctx.resolve(userId);
    await this.assertSubscriptionInEnterprise(subscriptionId, context.enterpriseId);

    const rows = await this.prisma.employeeGrant.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        expiresAt: true,
        createdAt: true,
        department: { select: { id: true, name: true } },
        member: {
          select: {
            id: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      department: r.department,
      member: r.member
        ? {
            id: r.member.id,
            name: r.member.user.name,
            email: r.member.user.email,
          }
        : null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      expired: r.expiresAt !== null && r.expiresAt < now,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 开通授权（企业管理员专用）。
   *
   * 授权对象二选一：部门或成员，DTO 层已用 refine 确保。
   * 已有相同授权 → 409（幂等意义上重复创建不如提示清楚）。
   */
  async create(
    userId: string,
    subscriptionId: string,
    dto: GrantCreateDto,
  ): Promise<GrantView> {
    const context = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(context);

    const subscription = await this.assertSubscriptionInEnterprise(
      subscriptionId,
      context.enterpriseId,
    );

    if (subscription.status === "EXPIRED") {
      throw new BadRequestException("已过期的雇佣关系无法授权");
    }

    if (dto.departmentId) {
      await this.assertDeptInEnterprise(
        dto.departmentId,
        context.enterpriseId,
      );
    }

    if (dto.memberId) {
      await this.assertMemberInEnterprise(
        dto.memberId,
        context.enterpriseId,
      );
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    try {
      const grant = await this.prisma.employeeGrant.create({
        data: {
          subscriptionId,
          departmentId: dto.departmentId ?? null,
          memberId: dto.memberId ?? null,
          expiresAt,
        },
        select: {
          id: true,
          expiresAt: true,
          createdAt: true,
          department: { select: { id: true, name: true } },
          member: {
            select: {
              id: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      });

      return {
        id: grant.id,
        department: grant.department,
        member: grant.member
          ? {
              id: grant.member.id,
              name: grant.member.user.name,
              email: grant.member.user.email,
            }
          : null,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        expired: false,
        createdAt: grant.createdAt,
      };
    } catch (e: unknown) {
      // Prisma P2002 = unique constraint violation
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        throw new ConflictException("该授权已存在");
      }
      throw e;
    }
  }

  /**
   * 收回授权（企业管理员专用）。
   *
   * 注意：收回授权**不影响**雇佣关系状态，只删除这条授权记录。
   * 如果要让整个雇佣关系下线，用 PATCH /subscriptions/:id/status 改成 SUSPENDED。
   */
  async remove(userId: string, grantId: string): Promise<{ id: string }> {
    const context = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(context);

    // 先查再删，确保这条授权属于本企业
    const grant = await this.prisma.employeeGrant.findUnique({
      where: { id: grantId },
      select: {
        id: true,
        subscription: { select: { enterpriseId: true } },
      },
    });

    if (
      !grant ||
      grant.subscription.enterpriseId !== context.enterpriseId
    ) {
      throw new NotFoundException(`授权记录 ${grantId} 不存在`);
    }

    await this.prisma.employeeGrant.delete({ where: { id: grantId } });
    return { id: grantId };
  }

  /**
   * 「我的员工」—— 当前成员可用的雇佣关系（使用者视角）。
   *
   * 合并两条授权路径（OR 关系，决策已确认）：
   * 1. 直接授权给当前成员（memberId = 我的 EnterpriseMember.id）
   * 2. 授权给我所在部门（departmentId = 我的 departmentId）
   *
   * 过滤条件：
   * - 雇佣关系处于 ACTIVE 状态（停用/回收的即使授权也不能用）
   * - 授权未过期（expiresAt 为空或 > now）
   *
   * 同一雇佣关系如果两条路径都命中，只返回一条，直接授权优先。
   */
  async myEmployees(userId: string): Promise<MyEmployeeView[]> {
    const context = await this.ctx.resolve(userId);
    const now = new Date();

    // 直接授权给我个人
    const directGrants = await this.prisma.employeeGrant.findMany({
      where: {
        memberId: context.memberId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        subscription: {
          enterpriseId: context.enterpriseId,
          status: "ACTIVE",
        },
      },
      include: {
        subscription: {
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                avatar: true,
                bindings: {
                  select: {
                    id: true,
                    priority: true,
                    capability: {
                      select: {
                        id: true,
                        name: true,
                        type: true,
                        description: true,
                      },
                    },
                  },
                  orderBy: { priority: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    // 授权给我所在部门
    const deptGrants =
      context.departmentId
        ? await this.prisma.employeeGrant.findMany({
            where: {
              departmentId: context.departmentId,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              subscription: {
                enterpriseId: context.enterpriseId,
                status: "ACTIVE",
              },
            },
            include: {
              subscription: {
                include: {
                  employee: {
                    select: { id: true, name: true, avatar: true },
                  },
                },
              },
            },
          })
        : [];

    // 去重，直接授权优先
    const seen = new Map<string, MyEmployeeView>();

    for (const g of directGrants) {
      const sub = g.subscription;
      seen.set(sub.id, {
        subscriptionId: sub.id,
        name: sub.name ?? sub.employee.name,
        templateVersion: sub.templateVersion,
        employee: sub.employee,
        department: null,
        grantSource: "DIRECT",
        expiresAt: g.expiresAt?.toISOString() ?? null,
      });
    }

    for (const g of deptGrants) {
      const sub = g.subscription;
      // 已有直接授权的不覆盖
      if (!seen.has(sub.id)) {
        seen.set(sub.id, {
          subscriptionId: sub.id,
          name: sub.name ?? sub.employee.name,
          templateVersion: sub.templateVersion,
          employee: sub.employee,
          department: null,
          grantSource: "DEPARTMENT",
          expiresAt: g.expiresAt?.toISOString() ?? null,
        });
      }
    }

    const rows = Array.from(seen.values());

    // 标注哪些模板有包可下 —— 否则前端只能盲点下载按钮，
    // 运营还没上传包时用户会拿到 404 却不知道为什么
    const employeeIds = [...new Set(rows.map((r) => r.employee.id))];
    const withPackage = await this.packages.employeeIdsWithPackage(employeeIds);
    for (const r of rows) {
      r.packageAvailable = withPackage.has(r.employee.id);
    }

    return rows;
  }

  // ── 内部校验 ──────────────────────────────────────────────────────────────

  private async assertSubscriptionInEnterprise(
    subscriptionId: string,
    enterpriseId: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true, enterpriseId: true, status: true },
    });
    if (!subscription || subscription.enterpriseId !== enterpriseId) {
      throw new NotFoundException(`雇佣关系 ${subscriptionId} 不存在`);
    }
    return subscription;
  }

  private async assertDeptInEnterprise(id: string, enterpriseId: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true },
    });
    if (!dept || dept.enterpriseId !== enterpriseId) {
      throw new NotFoundException(`部门 ${id} 不存在`);
    }
  }

  private async assertMemberInEnterprise(id: string, enterpriseId: string) {
    const member = await this.prisma.enterpriseMember.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true },
    });
    if (!member || member.enterpriseId !== enterpriseId) {
      throw new NotFoundException(`成员 ${id} 不存在`);
    }
  }
}

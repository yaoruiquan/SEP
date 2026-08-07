import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AssignDeptMembersDto,
  DepartmentCreateDto,
  DepartmentUpdateDto,
  DepartmentTreeNode,
  SetDeptLeaderDto,
} from "shared";
import { EnterpriseContextService } from "./enterprise-context.service";

@Injectable()
export class DepartmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
  ) {}

  /**
   * 返回本企业的完整部门树。
   *
   * 一次查全量再在内存里组装，而非递归查询：部门量级很小（几十到几百），
   * 递归 SQL 或多次往返都不值得。
   */
  async tree(userId: string): Promise<DepartmentTreeNode[]> {
    const ctx = await this.ctx.resolve(userId);

    const rows = await this.prisma.department.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        parentId: true,
        sortOrder: true,
        _count: { select: { members: true } },
      },
    });

    const byId = new Map<string, DepartmentTreeNode>();
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        parentId: r.parentId,
        sortOrder: r.sortOrder,
        memberCount: r._count.members,
        children: [],
      });
    }

    const roots: DepartmentTreeNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId) {
        // 父节点必然同企业（下方 create/update 保证），找不到则视为根
        byId.get(node.parentId)?.children.push(node) ?? roots.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async create(userId: string, dto: DepartmentCreateDto) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    if (dto.parentId) {
      // 父部门必须属于本企业 —— 否则可把自己的部门挂到别家企业的树下，
      // 造成跨企业的结构污染
      await this.assertInEnterprise(dto.parentId, ctx.enterpriseId);
    }

    return this.prisma.department.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        name: dto.name,
        parentId: dto.parentId,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(userId: string, id: string, dto: DepartmentUpdateDto) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);
    await this.assertInEnterprise(id, ctx.enterpriseId);

    if (dto.parentId !== undefined && dto.parentId !== null) {
      await this.assertInEnterprise(dto.parentId, ctx.enterpriseId);
      await this.assertNoCycle(id, dto.parentId);
    }

    return this.prisma.department.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  /**
   * 删除部门。
   *
   * 有子部门或有成员时拒绝，要求先清空 —— 而不是级联删除。
   * 级联删部门会连带把成员的部门归属抹掉甚至删掉成员，
   * 这种破坏性操作不该由一次点击隐式触发。
   */
  async remove(userId: string, id: string) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);
    await this.assertInEnterprise(id, ctx.enterpriseId);

    const [childCount, memberCount] = await Promise.all([
      this.prisma.department.count({ where: { parentId: id } }),
      this.prisma.enterpriseMember.count({ where: { departmentId: id } }),
    ]);

    if (childCount > 0) {
      throw new ConflictException(
        `该部门下还有 ${childCount} 个子部门，请先移除或移动它们`,
      );
    }
    if (memberCount > 0) {
      throw new ConflictException(
        `该部门下还有 ${memberCount} 名成员，请先调岗或移出`,
      );
    }

    await this.prisma.department.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ── 成员管理 ──────────────────────────────────────────────────────────────

  /** 列出指定部门的所有成员，支持姓名/邮箱搜索与分页。 */
  async listMembers(
    userId: string,
    deptId: string,
    opts: { search?: string; page?: number; limit?: number },
  ) {
    const ctx = await this.ctx.resolve(userId);
    await this.assertInEnterprise(deptId, ctx.enterpriseId);

    const { search, page = 1, limit = 50 } = opts;

    // 收集当前部门及所有子孙部门的 ID
    const allDeptIds = await this.collectDescendantIds(deptId, ctx.enterpriseId);

    const where: Record<string, unknown> = {
      departmentId: { in: allDeptIds }
    };
    if (search) {
      where["OR"] = [
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.enterpriseMember.count({ where }),
      this.prisma.enterpriseMember.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          position: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, avatar: true } },
        },
      }),
    ]);

    // 当前部门主管 ID，用于前端标注
    const dept = await this.prisma.department.findUnique({
      where: { id: deptId },
      select: { leaderId: true },
    });

    return { total, page, limit, leaderId: dept?.leaderId ?? null, items };
  }

  /**
   * 收集当前部门及其所有子孙部门的 ID（递归查询）
   */
  private async collectDescendantIds(
    deptId: string,
    enterpriseId: string,
  ): Promise<string[]> {
    const allDepts = await this.prisma.department.findMany({
      where: { enterpriseId },
      select: { id: true, parentId: true },
    });

    const childrenMap = new Map<string, string[]>();
    for (const d of allDepts) {
      if (d.parentId) {
        const siblings = childrenMap.get(d.parentId) ?? [];
        siblings.push(d.id);
        childrenMap.set(d.parentId, siblings);
      }
    }

    const result: string[] = [deptId];
    const queue = [deptId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childrenMap.get(current) ?? [];
      for (const child of children) {
        result.push(child);
        queue.push(child);
      }
    }
    return result;
  }

  /**
   * 将一批企业成员（EnterpriseMember）分配到指定部门。
   *
   * 成员必须属于本企业；已在该部门的成员幂等处理。
   */
  async assignMembers(
    userId: string,
    deptId: string,
    dto: AssignDeptMembersDto,
  ) {
    const ctx = await this.ctx.resolve(userId);
    await this.assertAdminOrDeptLeader(ctx, deptId);
    await this.assertInEnterprise(deptId, ctx.enterpriseId);

    // 确认所有 memberIds 属于本企业
    const members = await this.prisma.enterpriseMember.findMany({
      where: { id: { in: dto.memberIds }, enterpriseId: ctx.enterpriseId },
      select: { id: true },
    });
    if (members.length !== dto.memberIds.length) {
      throw new BadRequestException("部分成员 ID 无效或不属于本企业");
    }

    const updated = await this.prisma.enterpriseMember.updateMany({
      where: { id: { in: dto.memberIds }, enterpriseId: ctx.enterpriseId },
      data: { departmentId: deptId },
    });

    return { assigned: updated.count };
  }

  /**
   * 将成员从部门移除（departmentId 置 null）。
   *
   * 若被移除成员是该部门主管，同时清除 leaderId。
   */
  async removeMember(userId: string, deptId: string, memberId: string) {
    const ctx = await this.ctx.resolve(userId);
    await this.assertAdminOrDeptLeader(ctx, deptId);

    const member = await this.prisma.enterpriseMember.findUnique({
      where: { id: memberId },
      select: { id: true, enterpriseId: true, departmentId: true },
    });
    if (!member || member.enterpriseId !== ctx.enterpriseId) {
      throw new NotFoundException(`成员 ${memberId} 不存在`);
    }
    if (member.departmentId !== deptId) {
      throw new BadRequestException("该成员不在此部门中");
    }

    // 如果是部门主管，先清除主管标记
    const dept = await this.prisma.department.findUnique({
      where: { id: deptId },
      select: { leaderId: true },
    });
    if (dept?.leaderId === memberId) {
      await this.prisma.department.update({
        where: { id: deptId },
        data: { leaderId: null },
      });
    }

    await this.prisma.enterpriseMember.update({
      where: { id: memberId },
      data: { departmentId: null },
    });

    return { removed: true, memberId };
  }

  /**
   * 设置或清除部门主管。
   *
   * 新主管必须是该部门的成员；传 null 表示清除主管。
   * 仅企业管理员可操作（不允许主管自行指定继任者）。
   */
  async setLeader(userId: string, deptId: string, dto: SetDeptLeaderDto) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);
    await this.assertInEnterprise(deptId, ctx.enterpriseId);

    if (dto.memberId !== null) {
      const member = await this.prisma.enterpriseMember.findUnique({
        where: { id: dto.memberId },
        select: { id: true, enterpriseId: true, departmentId: true },
      });
      if (!member || member.enterpriseId !== ctx.enterpriseId) {
        throw new NotFoundException(`成员 ${dto.memberId} 不存在`);
      }
      if (member.departmentId !== deptId) {
        throw new BadRequestException("主管必须是该部门的成员");
      }
    }

    const updated = await this.prisma.department.update({
      where: { id: deptId },
      data: { leaderId: dto.memberId },
      select: { id: true, name: true, leaderId: true },
    });

    return updated;
  }

  // ── 内部校验 ──────────────────────────────────────────────────────────────

  /**
   * 要求企业管理员或该部门的主管（成员管理操作权限）。
   */
  private async assertAdminOrDeptLeader(
    ctx: import("./enterprise-context.service").EnterpriseContext,
    deptId: string,
  ) {
    if (ctx.role === "ENTERPRISE_ADMIN") return;

    const dept = await this.prisma.department.findUnique({
      where: { id: deptId },
      select: { leaderId: true },
    });
    if (!dept || dept.leaderId !== ctx.memberId) {
      throw new ForbiddenException("仅企业管理员或部门主管可执行此操作");
    }
  }

  /**
   * 校验部门属于指定企业。
   *
   * 越权时返回 404 而非 403：403 会告诉攻击者"该 id 真实存在，只是你没权限"，
   * 404 与"不存在"不可区分，不留探测信息差。
   */
  private async assertInEnterprise(id: string, enterpriseId: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true },
    });
    if (!dept || dept.enterpriseId !== enterpriseId) {
      throw new NotFoundException(`部门 ${id} 不存在`);
    }
    return dept;
  }

  /**
   * 防止把部门移动到自己的子孙节点下形成环。
   *
   * 环一旦形成，这些节点会从树里彻底消失（既非根、其祖先链又不可达），
   * 前端渲染时看不到、也删不掉，只能改数据库修复。
   * 自引用外键不会拦住这种情况，必须在应用层判断。
   */
  private async assertNoCycle(id: string, newParentId: string) {
    if (id === newParentId) {
      throw new BadRequestException("部门不能作为自己的父部门");
    }

    // 从目标父节点向上走，若遇到自己说明成环
    let cursor: string | null = newParentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        throw new BadRequestException("不能将部门移动到其子部门之下");
      }
      if (seen.has(cursor)) break; // 已有环（异常数据），避免死循环
      seen.add(cursor);

      const parent: { parentId: string | null } | null =
        await this.prisma.department.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
  }
}

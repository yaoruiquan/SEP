import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  DepartmentCreateDto,
  DepartmentUpdateDto,
  DepartmentTreeNode,
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

  // ── 内部校验 ──────────────────────────────────────────────────────────────

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

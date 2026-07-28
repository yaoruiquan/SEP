import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  InstanceCreateDto,
  InstanceUpdateDto,
  InstanceStatusValue,
  InstanceView,
} from "shared";
import { EnterpriseContextService } from "./enterprise-context.service";

/** 允许的状态流转。REVOKED 是终态。 */
const ALLOWED_TRANSITIONS: Record<InstanceStatusValue, InstanceStatusValue[]> = {
  PENDING_ACTIVATION: ["ACTIVE", "REVOKED"],
  ACTIVE: ["SUSPENDED", "REVOKED"],
  SUSPENDED: ["ACTIVE", "REVOKED"],
  // 回收后不可复活：凭据已吊销，且"回收"对企业是一次明确的终止动作，
  // 允许撤销会让权限状态难以审计
  REVOKED: [],
};

@Injectable()
export class InstanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
  ) {}

  /**
   * 列出本企业的员工实例，并附带升级提示。
   *
   * 升级判断只比较版本字符串是否相等，不做语义化版本比较 ——
   * 模板版本由运营发布时填写，只要与实例锁定的版本不同就提示。
   * 这样降级发布（如撤回到旧版）也会被提示，符合"有变化就告知"的预期。
   */
  async list(userId: string): Promise<InstanceView[]> {
    const ctx = await this.ctx.resolve(userId);

    const rows = await this.prisma.employeeInstance.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        templateVersion: true,
        config: true,
        createdAt: true,
        template: {
          select: { id: true, name: true, avatar: true, version: true },
        },
        department: { select: { id: true, name: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status as InstanceStatusValue,
      templateVersion: r.templateVersion,
      latestVersion: r.template.version,
      upgradeAvailable: r.template.version !== r.templateVersion,
      template: {
        id: r.template.id,
        name: r.template.name,
        avatar: r.template.avatar,
      },
      department: r.department,
      config: r.config as Record<string, unknown> | null,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 创建实例。
   *
   * 前置条件：本企业对该模板有 ACTIVE 订阅。
   * 订阅是"买了使用权"，实例是"实际部署一份" —— 没买不能部署。
   */
  async create(userId: string, dto: InstanceCreateDto) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);

    const subscription = await this.prisma.subscription.findUnique({
      where: {
        enterpriseId_employeeId: {
          enterpriseId: ctx.enterpriseId,
          employeeId: dto.templateId,
        },
      },
      select: { status: true },
    });
    if (!subscription) {
      throw new BadRequestException("请先订阅该员工，再创建实例");
    }
    if (subscription.status !== "ACTIVE") {
      throw new BadRequestException("该员工的订阅未生效，无法创建实例");
    }

    const template = await this.prisma.digitalEmployee.findUnique({
      where: { id: dto.templateId },
      select: { id: true, version: true, status: true },
    });
    if (!template) throw new NotFoundException("员工模板不存在");

    if (dto.departmentId) {
      await this.assertDepartmentInEnterprise(
        dto.departmentId,
        ctx.enterpriseId,
      );
    }

    return this.prisma.employeeInstance.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        templateId: dto.templateId,
        // 锁定当前版本：模板日后发新版时，此实例保持不动，仅提示升级
        templateVersion: template.version,
        name: dto.name,
        departmentId: dto.departmentId,
        config: dto.config,
        status: "PENDING_ACTIVATION",
      },
      select: {
        id: true,
        name: true,
        status: true,
        templateVersion: true,
        departmentId: true,
      },
    });
  }

  async update(userId: string, id: string, dto: InstanceUpdateDto) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);
    const inst = await this.assertInEnterprise(id, ctx.enterpriseId);

    if (inst.status === "REVOKED") {
      throw new ConflictException("已回收的实例不可修改");
    }

    if (dto.departmentId) {
      await this.assertDepartmentInEnterprise(
        dto.departmentId,
        ctx.enterpriseId,
      );
    }

    return this.prisma.employeeInstance.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.departmentId !== undefined && {
          departmentId: dto.departmentId,
        }),
        ...(dto.config !== undefined && { config: dto.config }),
      },
      select: { id: true, name: true, departmentId: true, config: true },
    });
  }

  /**
   * 变更实例状态（启用 / 停用 / 回收）。
   *
   * 停用与回收**不删除授权记录**：
   * 停用往往是临时的，删掉授权则恢复时要重新配一遍，是无谓的返工。
   * 权限判定以"实例状态 + 授权"两者共同决定 —— 实例非 ACTIVE 时
   * 一律不可用，授权记录留着不生效。
   *
   * 回收（REVOKED）是终态，不可转回。
   */
  async changeStatus(
    userId: string,
    id: string,
    next: InstanceStatusValue,
  ) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);
    const inst = await this.assertInEnterprise(id, ctx.enterpriseId);

    const current = inst.status as InstanceStatusValue;
    if (current === next) {
      return { id, status: current, changed: false };
    }
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new ConflictException(
        `实例状态不能从 ${current} 变为 ${next}`,
      );
    }

    const updated = await this.prisma.employeeInstance.update({
      where: { id },
      data: { status: next },
      select: { id: true, status: true },
    });
    return { ...updated, changed: true };
  }

  /**
   * 升级实例到模板最新版本（提示式升级，由企业主动确认，决策 14）。
   *
   * **不迁移 config**：新版可能增删配置项，自动迁移需要清单声明配置项的
   * 版本演进规则，成本高且容易静默写坏数据。这里只更新版本号并把结果
   * 告知调用方，由前端提示"请重新检查配置"。
   */
  async upgrade(userId: string, id: string) {
    const ctx = await this.ctx.resolve(userId);
    this.ctx.assertEnterpriseAdmin(ctx);
    const inst = await this.assertInEnterprise(id, ctx.enterpriseId);

    if (inst.status === "REVOKED") {
      throw new ConflictException("已回收的实例不可升级");
    }

    const template = await this.prisma.digitalEmployee.findUnique({
      where: { id: inst.templateId },
      select: { version: true },
    });
    if (!template) throw new NotFoundException("员工模板不存在");

    if (template.version === inst.templateVersion) {
      throw new ConflictException("当前已是最新版本");
    }

    const from = inst.templateVersion;
    const updated = await this.prisma.employeeInstance.update({
      where: { id },
      data: { templateVersion: template.version },
      select: { id: true, templateVersion: true },
    });

    return {
      ...updated,
      from,
      to: template.version,
      // 提醒前端：配置未自动迁移
      configReviewRequired: true,
    };
  }

  // ── 内部校验 ──────────────────────────────────────────────────────────────

  /** 越权返回 404，不泄漏该 id 是否存在。 */
  private async assertInEnterprise(id: string, enterpriseId: string) {
    const inst = await this.prisma.employeeInstance.findUnique({
      where: { id },
      select: {
        id: true,
        enterpriseId: true,
        status: true,
        templateId: true,
        templateVersion: true,
      },
    });
    if (!inst || inst.enterpriseId !== enterpriseId) {
      throw new NotFoundException(`实例 ${id} 不存在`);
    }
    return inst;
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

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SkillReviewActorType,
  SkillReviewDecision,
  SkillVersionScope,
  SkillVersionStatus,
} from '@prisma/client';
import matter from 'gray-matter';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { nextSemver } from './skill-version-numbering';
import type {
  CreateEnterpriseSkillVersionDto,
  CreatePlatformSkillVersionDto,
  ReviewSkillVersionDto,
  UpdateSkillVersionDto,
} from 'shared';

const VERSION_SUMMARY_SELECT = {
  id: true,
  capabilityId: true,
  scope: true,
  enterpriseId: true,
  parentVersionId: true,
  sourceVersionId: true,
  version: true,
  changeSummary: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class SkillVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  async listEmployeeSkills(userId: string, employeeId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const subscription = await this.getGrantedSubscription(
      ctx.enterpriseId,
      ctx.memberId,
      ctx.departmentId,
      employeeId,
    );

    const bindings = await this.prisma.employeeCapabilityBinding.findMany({
      where: { employeeId, capability: { type: 'SKILL' } },
      select: {
        capability: {
          select: { id: true, name: true, description: true, type: true },
        },
        defaultSkillVersion: { select: VERSION_SUMMARY_SELECT },
      },
      orderBy: { priority: 'asc' },
    });

    const capabilityIds = bindings.map((binding) => binding.capability.id);
    if (capabilityIds.length === 0) {
      return { subscriptionId: subscription.id, skills: [] };
    }

    const [versions, selections] = await Promise.all([
      this.prisma.skillVersion.findMany({
        where: {
          capabilityId: { in: capabilityIds },
          OR: [
            { scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
            {
              scope: 'ENTERPRISE',
              enterpriseId: ctx.enterpriseId,
              status: 'ENTERPRISE_APPROVED',
            },
          ],
        },
        select: VERSION_SUMMARY_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscriptionSkillVersion.findMany({
        where: { subscriptionId: subscription.id },
        select: {
          capabilityId: true,
          version: { select: VERSION_SUMMARY_SELECT },
        },
      }),
    ]);

    const versionsByCapability = new Map<string, typeof versions>();
    for (const version of versions) {
      const existing = versionsByCapability.get(version.capabilityId) ?? [];
      existing.push(version);
      versionsByCapability.set(version.capabilityId, existing);
    }
    const selectedByCapability = new Map(
      selections.map((selection) => [selection.capabilityId, selection.version]),
    );

    return {
      subscriptionId: subscription.id,
      canManage: ctx.role === 'ENTERPRISE_ADMIN',
      skills: bindings.map((binding) => {
        const candidates = versionsByCapability.get(binding.capability.id) ?? [];
        const currentVersion =
          selectedByCapability.get(binding.capability.id) ??
          binding.defaultSkillVersion ??
          candidates.find((version) => version.scope === 'PLATFORM') ??
          null;
        const latestPlatformVersion = candidates.find(
          (version) => version.scope === 'PLATFORM',
        );

        return {
          capability: binding.capability,
          currentVersion,
          versions: candidates,
          upgradeAvailable:
            Boolean(currentVersion && latestPlatformVersion) &&
            currentVersion?.id !== latestPlatformVersion?.id,
        };
      }),
    };
  }

  async previewEnterpriseVersion(userId: string, versionId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const version = await this.prisma.skillVersion.findUnique({
      where: { id: versionId },
      select: {
        ...VERSION_SUMMARY_SELECT,
        content: true,
        capability: { select: { id: true, name: true, description: true } },
      },
    });
    if (!version) throw new NotFoundException('技能版本不存在');
    if (version.scope === 'PLATFORM' && version.status !== 'PLATFORM_APPROVED') {
      throw new NotFoundException('技能版本不存在');
    }
    if (version.scope === 'ENTERPRISE' && version.enterpriseId !== ctx.enterpriseId) {
      throw new NotFoundException('技能版本不存在');
    }

    await this.assertCapabilityGrant(
      ctx.enterpriseId,
      ctx.memberId,
      ctx.departmentId,
      version.capabilityId,
    );
    return version;
  }

  async listEnterpriseVersions(userId: string, status?: SkillVersionStatus) {
    const ctx = await this.enterpriseContext.resolve(userId);
    return this.prisma.skillVersion.findMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        scope: 'ENTERPRISE',
        ...(status ? { status } : {}),
      },
      select: {
        ...VERSION_SUMMARY_SELECT,
        capability: { select: { id: true, name: true, description: true } },
        parentVersion: { select: VERSION_SUMMARY_SELECT },
        promotedVersions: { select: { id: true }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    }).then((versions) =>
      versions.map(({ promotedVersions, ...version }) => ({
        ...version,
        hasPlatformSubmission: promotedVersions.length > 0,
      })),
    );
  }

  async createEnterpriseVersion(
    userId: string,
    subscriptionId: string,
    dto: CreateEnterpriseSkillVersionDto,
  ) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const subscription = await this.getGrantedSubscriptionById(
      ctx.enterpriseId,
      ctx.memberId,
      ctx.departmentId,
      subscriptionId,
    );
    await this.assertCapabilityBound(subscription.employeeId, dto.capabilityId);

    const parent = await this.prisma.skillVersion.findUnique({
      where: { id: dto.parentVersionId },
    });
    if (!parent || parent.capabilityId !== dto.capabilityId) {
      throw new BadRequestException('父版本与技能不匹配');
    }
    const parentVisible =
      (parent.scope === 'PLATFORM' && parent.status === 'PLATFORM_APPROVED') ||
      (parent.scope === 'ENTERPRISE' && parent.enterpriseId === ctx.enterpriseId);
    if (!parentVisible) throw new NotFoundException('父版本不存在或不可访问');

    const version = await this.nextVersion(
      dto.capabilityId,
      'ENTERPRISE',
      ctx.enterpriseId,
    );
    return this.prisma.skillVersion.create({
      data: {
        capabilityId: dto.capabilityId,
        enterpriseId: ctx.enterpriseId,
        scope: 'ENTERPRISE',
        parentVersionId: parent.id,
        version,
        content: parent.content,
        changeSummary: dto.changeSummary,
        createdById: userId,
      },
      select: { ...VERSION_SUMMARY_SELECT, content: true },
    });
  }

  async updateEnterpriseVersion(
    userId: string,
    versionId: string,
    dto: UpdateSkillVersionDto,
  ) {
    const version = await this.getOwnedEnterpriseVersion(userId, versionId);
    if (version.status !== 'DRAFT' && version.status !== 'ENTERPRISE_REJECTED') {
      throw new ConflictException('只有草稿或被驳回版本可以编辑');
    }
    return this.prisma.skillVersion.update({
      where: { id: version.id },
      data: {
        content: this.stripFrontmatter(dto.content),
        changeSummary: dto.changeSummary,
      },
      select: { ...VERSION_SUMMARY_SELECT, content: true },
    });
  }

  async submitEnterpriseReview(userId: string, versionId: string) {
    const version = await this.getOwnedEnterpriseVersion(userId, versionId);
    if (version.status !== 'DRAFT' && version.status !== 'ENTERPRISE_REJECTED') {
      throw new ConflictException('当前状态不能提交企业审核');
    }
    if (version.parentVersionId && !version.changeSummary?.trim()) {
      throw new BadRequestException('请先填写本版本的变更说明');
    }
    return this.prisma.skillVersion.update({
      where: { id: version.id },
      data: {
        status: 'PENDING_ENTERPRISE_REVIEW',
        submittedAt: new Date(),
        rejectionReason: null,
      },
      select: VERSION_SUMMARY_SELECT,
    });
  }

  async reviewEnterpriseVersion(
    userId: string,
    versionId: string,
    dto: ReviewSkillVersionDto,
  ) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertCanApprove(ctx);
    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, enterpriseId: ctx.enterpriseId, scope: 'ENTERPRISE' },
    });
    if (!version) throw new NotFoundException('技能版本不存在');
    if (version.status !== 'PENDING_ENTERPRISE_REVIEW') {
      throw new ConflictException('只有待企业审核版本可以审核');
    }

    const approved = dto.decision === 'APPROVE';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.skillVersion.update({
        where: { id: version.id },
        data: {
          status: approved ? 'ENTERPRISE_APPROVED' : 'ENTERPRISE_REJECTED',
          enterpriseReviewedById: userId,
          enterpriseReviewedAt: new Date(),
          rejectionReason: approved ? null : dto.comment,
        },
        select: VERSION_SUMMARY_SELECT,
      });
      await tx.skillVersionReview.create({
        data: {
          versionId: version.id,
          actorType: 'ENTERPRISE',
          decision: dto.decision,
          reviewerId: userId,
          comment: dto.comment,
        },
      });
      return updated;
    });
  }

  async selectVersion(
    userId: string,
    subscriptionId: string,
    capabilityId: string,
    versionId: string,
  ) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    const subscription = await this.getActiveSubscriptionById(
      ctx.enterpriseId,
      subscriptionId,
    );
    await this.assertCapabilityBound(subscription.employeeId, capabilityId);

    const version = await this.prisma.skillVersion.findUnique({ where: { id: versionId } });
    if (!version || version.capabilityId !== capabilityId) {
      throw new BadRequestException('所选版本与技能不匹配');
    }
    const selectable =
      (version.scope === 'PLATFORM' && version.status === 'PLATFORM_APPROVED') ||
      (version.scope === 'ENTERPRISE' &&
        version.enterpriseId === ctx.enterpriseId &&
        version.status === 'ENTERPRISE_APPROVED');
    if (!selectable) throw new BadRequestException('该版本尚未审核通过或无权使用');

    return this.prisma.subscriptionSkillVersion.upsert({
      where: { subscriptionId_capabilityId: { subscriptionId, capabilityId } },
      create: { subscriptionId, capabilityId, versionId, selectedById: userId },
      update: { versionId, selectedById: userId, selectedAt: new Date() },
      include: { version: { select: VERSION_SUMMARY_SELECT } },
    });
  }

  async resolveEffectiveVersion(subscriptionId: string, capabilityId: string) {
    const selection = await this.prisma.subscriptionSkillVersion.findUnique({
      where: { subscriptionId_capabilityId: { subscriptionId, capabilityId } },
      include: { version: true },
    });
    if (selection) return selection.version;

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        employee: {
          select: {
            bindings: {
              where: { capabilityId },
              select: { defaultSkillVersion: true },
              take: 1,
            },
          },
        },
      },
    });
    const defaultVersion = subscription?.employee.bindings[0]?.defaultSkillVersion;
    if (defaultVersion?.status === 'PLATFORM_APPROVED') return defaultVersion;

    return this.prisma.skillVersion.findFirst({
      where: { capabilityId, scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitPlatformReview(userId: string, versionId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    const version = await this.prisma.skillVersion.findFirst({
      where: {
        id: versionId,
        scope: 'ENTERPRISE',
        enterpriseId: ctx.enterpriseId,
      },
    });
    if (!version) throw new NotFoundException('技能版本不存在');
    if (version.status !== 'ENTERPRISE_APPROVED') {
      throw new ConflictException('只有企业审核通过的版本可以提交平台');
    }
    const existing = await this.prisma.skillVersion.findUnique({
      where: { sourceVersionId: version.id },
      select: { id: true },
    });
    if (existing) throw new ConflictException('该企业版本已提交平台审核');

    const platformVersion = await this.nextVersion(version.capabilityId, 'PLATFORM');
    return this.prisma.skillVersion.create({
      data: {
        capabilityId: version.capabilityId,
        scope: 'PLATFORM',
        sourceVersionId: version.id,
        parentVersionId: version.parentVersionId,
        version: platformVersion,
        content: version.content,
        changeSummary: version.changeSummary,
        status: 'PENDING_PLATFORM_REVIEW',
        submittedAt: new Date(),
        createdById: userId,
      },
      select: VERSION_SUMMARY_SELECT,
    });
  }

  async listAdminVersions(filters: {
    status?: SkillVersionStatus;
    scope?: SkillVersionScope;
    page: number;
    limit: number;
  }) {
    const where = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.scope ? { scope: filters.scope } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.skillVersion.count({ where }),
      this.prisma.skillVersion.findMany({
        where,
        select: {
          ...VERSION_SUMMARY_SELECT,
          capability: { select: { id: true, name: true, description: true } },
          enterprise: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
    ]);
    return { total, page: filters.page, limit: filters.limit, items };
  }

  async getAdminVersion(versionId: string) {
    const version = await this.prisma.skillVersion.findUnique({
      where: { id: versionId },
      select: {
        ...VERSION_SUMMARY_SELECT,
        content: true,
        rejectionReason: true,
        capability: { select: { id: true, name: true, description: true } },
        enterprise: { select: { id: true, name: true } },
        parentVersion: { select: VERSION_SUMMARY_SELECT },
        sourceVersion: { select: VERSION_SUMMARY_SELECT },
        reviews: {
          select: {
            id: true,
            actorType: true,
            decision: true,
            comment: true,
            createdAt: true,
            reviewer: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!version) throw new NotFoundException('技能版本不存在');
    return version;
  }

  async createPlatformVersion(
    userId: string,
    capabilityId: string,
    dto: CreatePlatformSkillVersionDto,
  ) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
      select: { id: true, type: true },
    });
    if (!capability) throw new NotFoundException('技能不存在');
    if (capability.type !== 'SKILL') throw new BadRequestException('只有 SKILL 支持版本');
    const version = await this.nextVersion(capabilityId, 'PLATFORM');
    return this.prisma.skillVersion.create({
      data: {
        capabilityId,
        scope: 'PLATFORM',
        version,
        content: this.stripFrontmatter(dto.content),
        changeSummary: dto.changeSummary,
        createdById: userId,
      },
      select: { ...VERSION_SUMMARY_SELECT, content: true },
    });
  }

  async submitAdminPlatformReview(versionId: string) {
    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, scope: 'PLATFORM' },
    });
    if (!version) throw new NotFoundException('技能版本不存在');
    if (version.status !== 'DRAFT' && version.status !== 'PLATFORM_REJECTED') {
      throw new ConflictException('当前状态不能提交平台审核');
    }
    return this.prisma.skillVersion.update({
      where: { id: version.id },
      data: {
        status: 'PENDING_PLATFORM_REVIEW',
        submittedAt: new Date(),
        rejectionReason: null,
      },
      select: VERSION_SUMMARY_SELECT,
    });
  }

  async reviewPlatformVersion(
    userId: string,
    versionId: string,
    dto: ReviewSkillVersionDto,
  ) {
    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, scope: 'PLATFORM' },
    });
    if (!version) throw new NotFoundException('技能版本不存在');
    if (version.status !== 'PENDING_PLATFORM_REVIEW') {
      throw new ConflictException('只有待平台审核版本可以审核');
    }
    const approved = dto.decision === 'APPROVE';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.skillVersion.update({
        where: { id: version.id },
        data: {
          status: approved ? 'PLATFORM_APPROVED' : 'PLATFORM_REJECTED',
          platformReviewedById: userId,
          platformReviewedAt: new Date(),
          rejectionReason: approved ? null : dto.comment,
        },
        select: VERSION_SUMMARY_SELECT,
      });
      await tx.skillVersionReview.create({
        data: {
          versionId: version.id,
          actorType: 'PLATFORM',
          decision: dto.decision,
          reviewerId: userId,
          comment: dto.comment,
        },
      });
      return updated;
    });
  }

  private async getOwnedEnterpriseVersion(userId: string, versionId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, enterpriseId: ctx.enterpriseId, scope: 'ENTERPRISE' },
    });
    if (!version) throw new NotFoundException('技能版本不存在');
    return version;
  }

  private async getGrantedSubscription(
    enterpriseId: string,
    memberId: string,
    departmentId: string | null,
    employeeId: string,
  ) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        enterpriseId,
        employeeId,
        status: 'ACTIVE',
        grants: { some: this.activeGrantWhere(memberId, departmentId) },
      },
      select: { id: true, employeeId: true, enterpriseId: true },
    });
    if (!subscription) throw new ForbiddenException('当前成员未获得该员工的使用授权');
    return subscription;
  }

  private async getGrantedSubscriptionById(
    enterpriseId: string,
    memberId: string,
    departmentId: string | null,
    subscriptionId: string,
  ) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        enterpriseId,
        status: 'ACTIVE',
        grants: { some: this.activeGrantWhere(memberId, departmentId) },
      },
      select: { id: true, employeeId: true, enterpriseId: true },
    });
    if (!subscription) throw new ForbiddenException('当前成员未获得该员工的使用授权');
    return subscription;
  }

  private async getActiveSubscriptionById(enterpriseId: string, subscriptionId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, enterpriseId, status: 'ACTIVE' },
      select: { id: true, employeeId: true, enterpriseId: true },
    });
    if (!subscription) throw new NotFoundException('有效订阅不存在');
    return subscription;
  }

  private async assertCapabilityGrant(
    enterpriseId: string,
    memberId: string,
    departmentId: string | null,
    capabilityId: string,
  ) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        enterpriseId,
        status: 'ACTIVE',
        employee: { bindings: { some: { capabilityId } } },
        grants: { some: this.activeGrantWhere(memberId, departmentId) },
      },
      select: { id: true },
    });
    if (!subscription) throw new ForbiddenException('当前成员无权查看该技能正文');
  }

  private activeGrantWhere(memberId: string, departmentId: string | null) {
    const targets: Array<{ memberId?: string; departmentId?: string }> = [{ memberId }];
    if (departmentId) targets.push({ departmentId });
    return {
      OR: targets,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    };
  }

  private async assertCapabilityBound(employeeId: string, capabilityId: string) {
    const binding = await this.prisma.employeeCapabilityBinding.findFirst({
      where: { employeeId, capabilityId, capability: { type: 'SKILL' } },
      select: { id: true },
    });
    if (!binding) throw new BadRequestException('该技能未绑定到当前员工');
  }

  private async nextVersion(
    capabilityId: string,
    scope: SkillVersionScope,
    enterpriseId?: string,
  ) {
    const versions = await this.prisma.skillVersion.findMany({
      where: { capabilityId, scope, enterpriseId: scope === 'ENTERPRISE' ? enterpriseId : null },
      select: { version: true },
    });
    return nextSemver(versions.map((row) => row.version));
  }

  private stripFrontmatter(content: string) {
    return matter(content).content.trimStart();
  }

  // ────────────────── 使用记录与统计 ──────────────────

  /**
   * 「这个成员看得到这个能力吗」的统一把关。
   *
   * 判据是「有一个授权订阅，且该订阅的员工绑定了这个能力」。三个读接口
   * （版本时间线 / 使用统计 / 执行明细）共用它 —— 各写一遍必然有一处漏掉，
   * 而漏掉的那个接口会把别的部门的技能数据交出去。
   */
  private async assertCapabilityVisible(
    ctx: { enterpriseId: string; memberId: string; departmentId: string | null },
    capabilityId: string,
  ) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        enterpriseId: ctx.enterpriseId,
        status: 'ACTIVE',
        grants: { some: this.activeGrantWhere(ctx.memberId, ctx.departmentId) },
        employee: { bindings: { some: { capabilityId } } },
      },
      select: { id: true },
    });
    if (!subscription) throw new ForbiddenException('当前成员未获得该技能的使用授权');
    return subscription;
  }

  /**
   * 「能力迭代」列表：当前成员有授权的所有 SKILL 类能力。
   *
   * 与 `listEmployeeSkills` 的区别：那个按员工进入（我要看这位员工带哪些技能），
   * 这个按能力进入（我要迭代这个技能）。同一个技能可能绑在多位员工身上，
   * 这里按 capability 去重，并带上「哪些员工在用」。
   */
  async listIterableCapabilities(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);

    // 本成员有授权的 ACTIVE 订阅
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        status: 'ACTIVE',
        grants: { some: this.activeGrantWhere(ctx.memberId, ctx.departmentId) },
      },
      select: {
        id: true,
        employeeId: true,
        employee: {
          select: {
            id: true,
            name: true,
            bindings: {
              where: { capability: { type: 'SKILL' } },
              select: {
                capability: { select: { id: true, name: true, description: true } },
                defaultSkillVersion: { select: VERSION_SUMMARY_SELECT },
              },
              orderBy: { priority: 'asc' },
            },
          },
        },
        skillVersionSelections: {
          select: { capabilityId: true, version: { select: VERSION_SUMMARY_SELECT } },
        },
      },
    });

    // 按 capability 归并：一个技能可能绑在多位员工身上
    type CapabilityEntry = {
      capability: { id: string; name: string; description: string };
      employees: Array<{ employeeId: string; employeeName: string; subscriptionId: string }>;
      currentVersion: { id: string; version: string; scope: SkillVersionScope } | null;
    };
    const byCapability = new Map<string, CapabilityEntry>();

    for (const subscription of subscriptions) {
      const selected = new Map(
        subscription.skillVersionSelections.map((s) => [s.capabilityId, s.version]),
      );
      for (const binding of subscription.employee.bindings) {
        const capabilityId = binding.capability.id;
        const entry = byCapability.get(capabilityId) ?? {
          capability: binding.capability,
          employees: [],
          // 生效版本：企业选版 > 员工模板默认版。与 resolveEffectiveVersion 同序，
          // 但这里不查平台兜底 —— 列表只需要展示「企业当前的选择」，
          // 兜底版本在详情页由 listVersionTimeline 给出。
          currentVersion: selected.get(capabilityId) ?? binding.defaultSkillVersion ?? null,
        };
        entry.employees.push({
          employeeId: subscription.employee.id,
          employeeName: subscription.employee.name,
          subscriptionId: subscription.id,
        });
        // 已有条目时，企业选版优先于模板默认版
        const explicit = selected.get(capabilityId);
        if (explicit) entry.currentVersion = explicit;
        byCapability.set(capabilityId, entry);
      }
    }

    const capabilityIds = [...byCapability.keys()];
    if (capabilityIds.length === 0) return { canManage: ctx.role === 'ENTERPRISE_ADMIN', items: [] };

    // 每个能力的调用轮次与使用人数，一次 groupBy 拿全，避免 N+1
    const [roundsByCapability, executions] = await Promise.all([
      this.prisma.toolExecution.groupBy({
        by: ['capabilityId'],
        where: {
          capabilityId: { in: capabilityIds },
          session: {
            user: { memberships: { some: { enterpriseId: ctx.enterpriseId } } },
          },
        },
        _count: { _all: true },
      }),
      this.prisma.toolExecution.findMany({
        where: {
          capabilityId: { in: capabilityIds },
          session: {
            user: { memberships: { some: { enterpriseId: ctx.enterpriseId } } },
          },
        },
        select: { capabilityId: true, userId: true },
        distinct: ['capabilityId', 'userId'],
      }),
    ]);

    const roundsMap = new Map(roundsByCapability.map((row) => [row.capabilityId, row._count._all]));
    const userCountMap = new Map<string, number>();
    for (const row of executions) {
      if (!row.userId) continue;
      userCountMap.set(row.capabilityId, (userCountMap.get(row.capabilityId) ?? 0) + 1);
    }

    return {
      canManage: ctx.role === 'ENTERPRISE_ADMIN',
      items: [...byCapability.values()].map((entry) => ({
        capability: entry.capability,
        employees: entry.employees,
        currentVersion: entry.currentVersion,
        usage: {
          totalRounds: roundsMap.get(entry.capability.id) ?? 0,
          distinctUserCount: userCountMap.get(entry.capability.id) ?? 0,
        },
      })),
    };
  }

  /**
   * 版本时间线：这个能力在本企业可见的全部版本，标出当前生效的那个。
   *
   * 平台版与企业版混排、按创建时间倒序 —— 用户要的是「我改过几版、现在用哪版、
   * 能退回哪版」，而不是两个分开的列表。
   */
  async listVersionTimeline(userId: string, capabilityId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const subscription = await this.assertCapabilityVisible(ctx, capabilityId);

    const [capability, versions, selection] = await Promise.all([
      this.prisma.capability.findUnique({
        where: { id: capabilityId },
        select: { id: true, name: true, description: true },
      }),
      this.prisma.skillVersion.findMany({
        where: {
          capabilityId,
          OR: [
            { scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
            // 企业版把草稿与待审也列出来：迭代过程本身要可见，
            // 只显示已通过的版本会让「我提交的那版去哪了」无从回答
            { scope: 'ENTERPRISE', enterpriseId: ctx.enterpriseId },
          ],
        },
        select: {
          ...VERSION_SUMMARY_SELECT,
          createdBy: { select: { id: true, name: true } },
          enterpriseReviewedBy: { select: { id: true, name: true } },
          enterpriseReviewedAt: true,
          rejectionReason: true,
          reviews: {
            select: {
              id: true,
              actorType: true,
              decision: true,
              comment: true,
              createdAt: true,
              reviewer: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          promotedVersions: { select: { id: true }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscriptionSkillVersion.findUnique({
        where: {
          subscriptionId_capabilityId: { subscriptionId: subscription.id, capabilityId },
        },
        select: { versionId: true, selectedAt: true },
      }),
    ]);

    if (!capability) throw new NotFoundException('能力不存在');

    return {
      capability,
      subscriptionId: subscription.id,
      canManage: ctx.role === 'ENTERPRISE_ADMIN',
      currentVersionId: selection?.versionId ?? null,
      selectedAt: selection?.selectedAt?.toISOString() ?? null,
      versions: versions.map(({ promotedVersions, ...version }) => ({
        ...version,
        hasPlatformSubmission: promotedVersions.length > 0,
        isCurrent: version.id === selection?.versionId,
      })),
    };
  }

  /**
   * 使用记录汇总：三层聚合（总览 + 分员工 + 分用户）。
   *
   * 调用方权限决定可见范围：
   * - 普通员工看到 summary + byEmployee（全企业范围）
   * - 企业管理员额外看到 byMember（具体到人）
   */
  async getUsageSummary(userId: string, capabilityId: string, isAdmin: boolean) {
    const ctx = await this.enterpriseContext.resolve(userId);
    // 授权校验：没有授权的成员连这个技能的存在都不该感知到，
    // 更不能读它的使用统计。与 listVersionTimeline 用同一把关。
    await this.assertCapabilityVisible(ctx, capabilityId);

    // 查本企业对这个技能的所有执行记录（不限版本 —— 企业可能在不同版本间切换）
    const executions = await this.prisma.toolExecution.findMany({
      where: {
        capabilityId,
        // userId 通过 session → user 关联，先查出本企业的所有会话再过滤
        session: {
          user: {
            memberships: {
              some: { enterpriseId: ctx.enterpriseId },
            },
          },
        },
      },
      select: {
        id: true,
        sessionId: true,
        userId: true,
        skillVersionId: true,
        session: {
          select: {
            employeeId: true,
            employee: { select: { name: true } },
          },
        },
        user: { select: { name: true } },
      },
    });

    const distinctUserIds = new Set(executions.map((e) => e.userId).filter(Boolean));
    const distinctSessionIds = new Set(executions.map((e) => e.sessionId));

    // 按员工聚合
    const byEmployeeMap = new Map<string, { name: string; count: number }>();
    for (const exec of executions) {
      const id = exec.session.employeeId;
      const entry = byEmployeeMap.get(id) ?? { name: exec.session.employee.name, count: 0 };
      entry.count += 1;
      byEmployeeMap.set(id, entry);
    }

    const byEmployee = Array.from(byEmployeeMap.entries()).map(([employeeId, data]) => ({
      employeeId,
      employeeName: data.name,
      rounds: data.count,
    }));

    // 按用户聚合（仅管理员可见）
    let byMember: Array<{ userId: string; userName: string | null; rounds: number }> | undefined;
    if (isAdmin) {
      const byMemberMap = new Map<string, { name: string | null; count: number }>();
      for (const exec of executions) {
        if (!exec.userId) continue;
        const entry = byMemberMap.get(exec.userId) ?? { name: exec.user?.name ?? null, count: 0 };
        entry.count += 1;
        byMemberMap.set(exec.userId, entry);
      }
      byMember = Array.from(byMemberMap.entries()).map(([userId, data]) => ({
        userId,
        userName: data.name,
        rounds: data.count,
      }));
    }

    return {
      summary: {
        distinctUserCount: distinctUserIds.size,
        totalConversations: distinctSessionIds.size,
        totalRounds: executions.length,
      },
      byEmployee,
      byMember,
    };
  }

  /**
   * 执行明细：单次调用的输入输出与版本归属，游标分页。
   *
   * 仅企业管理员可见 —— 涉及员工对话内容，普通员工不该看到。
   */
  async getExecutionDetails(
    userId: string,
    capabilityId: string,
    limit: number,
    cursor?: string,
  ) {
    const ctx = await this.enterpriseContext.resolve(userId);
    await this.assertCapabilityVisible(ctx, capabilityId);

    const executions = await this.prisma.toolExecution.findMany({
      where: {
        capabilityId,
        session: {
          user: {
            memberships: {
              some: { enterpriseId: ctx.enterpriseId },
            },
          },
        },
        ...(cursor && { createdAt: { lt: new Date(cursor) } }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sessionId: true,
        input: true,
        output: true,
        status: true,
        errorMessage: true,
        duration: true,
        skillVersionId: true,
        skillVersion: { select: { scope: true } },
        userId: true,
        user: { select: { name: true } },
        createdAt: true,
      },
    });

    const items = executions.map((exec) => ({
      id: exec.id,
      sessionId: exec.sessionId,
      input: exec.input,
      output: exec.output,
      status: exec.status,
      errorMessage: exec.errorMessage,
      duration: exec.duration,
      skillVersionId: exec.skillVersionId,
      versionScope: exec.skillVersion?.scope ?? null,
      userId: exec.userId,
      userName: exec.user?.name ?? null,
      createdAt: exec.createdAt.toISOString(),
    }));

    const nextCursor =
      executions.length === limit ? executions[executions.length - 1].createdAt.toISOString() : null;

    return { items, nextCursor };
  }
}

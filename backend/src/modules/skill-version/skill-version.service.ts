import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SkillReviewActorType,
  SkillReviewDecision,
  SkillVersionScope,
  SkillVersionStatus,
} from '@prisma/client';
import matter from 'gray-matter';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { mergePersonalEdits } from './merge-personal-edits';
import { nextSemver } from './skill-version-numbering';
import type {
  AdoptPersonalVersionsDto,
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
  private readonly logger = new Logger(SkillVersionService.name);

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

  /**
   * 本次执行实际该用哪一版技能正文。
   *
   * 优先级 —— 越靠上越贴近「谁在用」：
   *   1. PERSONAL   该成员自己的副本（会议：使用发生在个人，改完下一句对话就该用上）
   *   2. 企业选版   SubscriptionSkillVersion（管理员为这条雇佣关系钉的版本）
   *   3. 模板默认版 EmployeeCapabilityBinding.defaultSkillVersion
   *   4. 平台最新   最后一个 PLATFORM_APPROVED
   *
   * `userId` 为空时跳过第 1 层 —— 任务执行等场景可能没有明确的「使用者」。
   */
  async resolveEffectiveVersion(
    subscriptionId: string,
    capabilityId: string,
    userId?: string,
  ) {
    if (userId) {
      const personal = await this.prisma.skillVersion.findFirst({
        where: {
          capabilityId,
          scope: 'PERSONAL',
          ownerId: userId,
          status: 'PERSONAL_ACTIVE',
        },
        // 一人一能力理论上只有一条（createPersonalVersion 会复用现有的），
        // 取最新是为了历史脏数据也能有确定行为
        orderBy: { createdAt: 'desc' },
      });
      if (personal) return personal;
    }

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
          // 企业投稿创建的是 scope=PLATFORM 版本，自身 enterpriseId 为空，
          // 来源企业要顺 sourceVersionId 回查，否则「来源企业」一栏永远是空的。
          sourceVersion: { select: { enterprise: { select: { id: true, name: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
    ]);
    return {
      total,
      page: filters.page,
      limit: filters.limit,
      items: items.map(({ sourceVersion, ...item }) => ({
        ...item,
        enterprise: item.enterprise ?? sourceVersion?.enterprise ?? null,
      })),
    };
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


  // ────────────────── 员工个人副本与采纳（会议纪要2 §6.4）──────────────────
  //
  // 会议明确否掉了「普通员工上传+提审」：员工改自己的副本，改完立刻对他本人生效，
  // 管理员天然可见并可逐条 / 一键采纳。这一组方法就是那句话的全部实现。

  /**
   * 员工基于当前生效版本创建自己的副本。
   *
   * 幂等：已有副本时直接返回它，不再建第二条 —— 一人一能力只该有一个副本，
   * 否则 resolveEffectiveVersion 得靠 createdAt 猜「哪个才是我现在用的」。
   */
  async createPersonalVersion(userId: string, capabilityId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const subscription = await this.assertCapabilityVisible(ctx, capabilityId);

    const existing = await this.prisma.skillVersion.findFirst({
      where: { capabilityId, scope: 'PERSONAL', ownerId: userId, status: 'PERSONAL_ACTIVE' },
      select: { ...VERSION_SUMMARY_SELECT, content: true, ownerId: true },
    });
    if (existing) return existing;

    // 副本的起点是「我现在实际在用的那一版」，不是平台原版 ——
    // 否则员工一建副本就把企业的定制丢了。
    const base = await this.resolveEffectiveVersion(subscription.id, capabilityId);
    if (!base) throw new NotFoundException('该技能还没有可用版本，无法创建副本');

    return this.prisma.skillVersion.create({
      data: {
        capabilityId,
        enterpriseId: ctx.enterpriseId,
        scope: 'PERSONAL',
        status: 'PERSONAL_ACTIVE',
        ownerId: userId,
        parentVersionId: base.id,
        // 个人副本不参与 semver 序列，版本号只记「基于哪一版」，
        // 让界面能说出「我的副本（基于 企业版 1.1.0）」
        version: base.version,
        content: base.content,
        createdById: userId,
      },
      select: { ...VERSION_SUMMARY_SELECT, content: true, ownerId: true },
    });
  }

  /** 员工编辑自己的副本。改完即生效，没有提审这一步。 */
  async updatePersonalVersion(
    userId: string,
    versionId: string,
    dto: UpdateSkillVersionDto,
  ) {
    const version = await this.getOwnedPersonalVersion(userId, versionId);
    return this.prisma.skillVersion.update({
      where: { id: version.id },
      data: {
        content: this.stripFrontmatter(dto.content),
        changeSummary: dto.changeSummary,
      },
      select: { ...VERSION_SUMMARY_SELECT, content: true, ownerId: true },
    });
  }

  /**
   * 弃用个人副本，回落到企业版。
   *
   * 已被采纳过的副本不物理删除 —— 它是某个企业版的来源证据，删了「这一版从哪来」
   * 就断了。改成 ARCHIVED，resolveEffectiveVersion 只认 PERSONAL_ACTIVE，
   * 所以归档后自动回落。
   */
  async discardPersonalVersion(userId: string, versionId: string) {
    const version = await this.getOwnedPersonalVersion(userId, versionId);
    const adopted = await this.prisma.skillVersionAdoption.count({
      where: { sourceVersionId: version.id },
    });
    if (adopted > 0) {
      return this.prisma.skillVersion.update({
        where: { id: version.id },
        data: { status: 'ARCHIVED' },
        select: VERSION_SUMMARY_SELECT,
      });
    }
    await this.prisma.skillVersion.delete({ where: { id: version.id } });
    return { id: version.id, deleted: true };
  }

  /**
   * 「大家的改动」：本企业内所有成员对这个能力的个人副本。
   *
   * 管理员看全部，普通成员只看自己 —— 会议要的是「管理员能看到每个人改了什么」，
   * 不是「所有人互相可见」。
   */
  async listPersonalDiffs(userId: string, capabilityId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    await this.assertCapabilityVisible(ctx, capabilityId);
    const canManage = ctx.role === 'ENTERPRISE_ADMIN';

    const [baseline, versions] = await Promise.all([
      // 基线是企业当前生效版本；没有企业版才退到最新平台版。
      // diff 要有比较对象，否则「他改了什么」只能靠人读全文。
      //
      // ⚠️ 不能用一条 findFirst + orderBy scope 解决：Postgres 按枚举**声明顺序**
      // 排序，而 SkillVersionScope 的声明是 PLATFORM 在前，`asc` 会把平台版排在
      // 企业版之前 —— 结果是采纳完之后 diff 仍然拿平台原版当基线，
      // 把企业已有的定制显示成成员的改动。
      this.resolveEnterpriseBaseline(ctx.enterpriseId, capabilityId),
      this.prisma.skillVersion.findMany({
        where: {
          capabilityId,
          scope: 'PERSONAL',
          status: 'PERSONAL_ACTIVE',
          enterpriseId: ctx.enterpriseId,
          ...(canManage ? {} : { ownerId: userId }),
        },
        select: {
          ...VERSION_SUMMARY_SELECT,
          content: true,
          ownerId: true,
          owner: { select: { id: true, name: true, email: true } },
          parentVersion: { select: { id: true, scope: true, version: true } },
          adoptedInto: {
            select: { id: true, targetVersionId: true, adoptedAt: true, batchId: true },
            orderBy: { adoptedAt: 'desc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      canManage,
      baseline: baseline
        ? { id: baseline.id, scope: baseline.scope, version: baseline.version, content: baseline.content }
        : null,
      items: versions.map((version) => ({
        id: version.id,
        owner: version.owner,
        basedOn: version.parentVersion,
        changeSummary: version.changeSummary,
        content: version.content,
        updatedAt: version.updatedAt,
        // 采纳过之后又改了 → 这条改动重新变成「待采纳」。
        // 只看 adoptedInto 是否为空会把「改了第二次」的人漏掉。
        adopted: version.adoptedInto.length > 0,
        adoptedAt: version.adoptedInto[0]?.adoptedAt ?? null,
        pending:
          version.adoptedInto.length === 0 ||
          version.updatedAt > (version.adoptedInto[0]?.adoptedAt ?? new Date(0)),
      })),
    };
  }

  /**
   * 采纳成员的个人改动，生成新的企业版本。
   *
   * 一个 id = 逐条采纳；多个 id = 一键采纳多人改动（会议两种都要）。
   * 多人改动怎么合并是个真问题 —— 这里的规则是**按更新时间顺序逐条叠加正文**，
   * 并在变更说明里如实列出每条的来源。不做智能三方合并：那需要语义理解，
   * 猜错了会产出一份没人写过的技能正文，比让管理员自己看更危险。
   *
   * 采纳后立即：① 生成 ENTERPRISE_APPROVED 版本（不再走审核流 —— 采纳动作本身
   * 就是管理员做的）② 给所有带这个能力的雇佣关系切到新版 ③ 通知企业成员。
   */
  async adoptPersonalVersions(
    userId: string,
    capabilityId: string,
    dto: AdoptPersonalVersionsDto,
  ) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    await this.assertCapabilityVisible(ctx, capabilityId);

    const sources = await this.prisma.skillVersion.findMany({
      where: {
        id: { in: dto.sourceVersionIds },
        capabilityId,
        scope: 'PERSONAL',
        enterpriseId: ctx.enterpriseId,
      },
      select: {
        id: true,
        content: true,
        changeSummary: true,
        updatedAt: true,
        owner: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });
    if (sources.length !== dto.sourceVersionIds.length) {
      throw new NotFoundException('部分改动不存在或不属于本企业');
    }

    // 多条时做行级并集合并，而不是「取最后一条」——
    // 后者会让「采纳 2 条」实际只生效 1 条，另一个人的改动被静默丢掉，
    // 而变更说明里却写着两个人的名字：界面说做了，实际没做。
    const baseline = await this.resolveEnterpriseBaseline(ctx.enterpriseId, capabilityId);
    const merged = mergePersonalEdits(
      baseline?.content ?? sources[0].content,
      sources.map((source) => ({
        label: source.owner.name ?? '未知成员',
        content: source.content,
      })),
    );

    const attribution = sources
      .map((s) => `${s.owner.name}${s.changeSummary ? `：${s.changeSummary}` : ''}`)
      .join('；');
    const conflictNote = merged.conflicts.length
      ? `；⚠️ ${merged.conflicts.length} 处内容被多人改成了不同版本，均已并入正文，请复核第 ${merged.conflicts
          .map((conflict) => conflict.line)
          .join('、')} 行附近`
      : '';
    const changeSummary =
      dto.changeSummary?.trim() ||
      (sources.length === 1
        ? `采纳 ${attribution}`
        : `一键采纳 ${sources.length} 位成员的改动 —— ${attribution}${conflictNote}`);

    const version = await this.nextVersion(capabilityId, 'ENTERPRISE', ctx.enterpriseId);
    const batchId = sources.length > 1 ? randomUUID() : null;

    const created = await this.prisma.$transaction(async (tx) => {
      const enterpriseVersion = await tx.skillVersion.create({
        data: {
          capabilityId,
          enterpriseId: ctx.enterpriseId,
          scope: 'ENTERPRISE',
          status: 'ENTERPRISE_APPROVED',
          version,
          content: merged.content,
          changeSummary,
          createdById: userId,
          enterpriseReviewedById: userId,
          enterpriseReviewedAt: new Date(),
        },
        select: { ...VERSION_SUMMARY_SELECT, content: true },
      });

      await tx.skillVersionAdoption.createMany({
        data: sources.map((source) => ({
          targetVersionId: enterpriseVersion.id,
          sourceVersionId: source.id,
          adoptedById: userId,
          batchId,
        })),
      });

      // 采纳了但不切生效版本，等于什么也没发生 —— 会议要的是「采纳后迭代版本」。
      // 只切本企业内绑定了这个能力的 ACTIVE 雇佣关系。
      const subscriptions = await tx.subscription.findMany({
        where: {
          enterpriseId: ctx.enterpriseId,
          status: 'ACTIVE',
          employee: { bindings: { some: { capabilityId } } },
        },
        select: { id: true },
      });
      for (const subscription of subscriptions) {
        await tx.subscriptionSkillVersion.upsert({
          where: {
            subscriptionId_capabilityId: { subscriptionId: subscription.id, capabilityId },
          },
          create: {
            subscriptionId: subscription.id,
            capabilityId,
            versionId: enterpriseVersion.id,
            selectedById: userId,
          },
          update: { versionId: enterpriseVersion.id, selectedById: userId },
        });
      }

      return { enterpriseVersion, affectedSubscriptions: subscriptions.length };
    });

    await this.notifySkillVersionUpdated(ctx.enterpriseId, capabilityId, created.enterpriseVersion.version);

    return {
      version: created.enterpriseVersion,
      adoptedCount: sources.length,
      affectedSubscriptions: created.affectedSubscriptions,
      batchId,
      // 冲突如实上报，界面要提示管理员去看 —— 合并本身不理解语义
      conflicts: merged.conflicts,
    };
  }

  /**
   * 「XX 技能更新了能力」——会议纪要2 §6.6 要求采纳后推送给客户端。
   *
   * 通知发送失败不能让采纳回滚：版本已经生效了，回滚会让「我明明点了采纳」
   * 和实际状态不一致。所以放在事务外，失败只记日志。
   */
  private async notifySkillVersionUpdated(
    enterpriseId: string,
    capabilityId: string,
    version: string,
  ) {
    try {
      const [capability, members] = await Promise.all([
        this.prisma.capability.findUnique({
          where: { id: capabilityId },
          select: { name: true },
        }),
        this.prisma.enterpriseMember.findMany({
          where: { enterpriseId },
          select: { userId: true },
        }),
      ]);
      if (!capability || members.length === 0) return;
      await this.prisma.notification.createMany({
        data: members.map((member) => ({
          userId: member.userId,
          type: 'SKILL_VERSION_UPDATED' as const,
          title: `${capability.name} 更新了能力`,
          message: `企业已采纳成员改动，当前生效版本 ${version}。下次使用即生效。`,
          relatedType: 'capability',
          relatedId: capabilityId,
        })),
      });
    } catch (error) {
      this.logger.error(
        `采纳后通知发送失败 capability=${capabilityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * 直接用给定正文创建一个已生效的企业版本，并切为所有相关雇佣关系的生效版本。
   *
   * 采纳个人改动（adoptPersonalVersions）与采纳 AI 建议（CapabilityInsightService.adopt）
   * 都要做这件事。抽出来是因为「创建版本」和「切生效」必须同一个事务 ——
   * 分开写过一次就会出现「版本建了但没生效」，界面上看不出来。
   *
   * 调用方负责授权校验（两个入口都已 assertEnterpriseAdmin）。
   */
  async createEnterpriseVersionFromContent(
    userId: string,
    enterpriseId: string,
    capabilityId: string,
    content: string,
    changeSummary: string,
  ) {
    const version = await this.nextVersion(capabilityId, 'ENTERPRISE', enterpriseId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.skillVersion.create({
        data: {
          capabilityId,
          enterpriseId,
          scope: 'ENTERPRISE',
          status: 'ENTERPRISE_APPROVED',
          version,
          content: this.stripFrontmatter(content),
          changeSummary,
          createdById: userId,
          enterpriseReviewedById: userId,
          enterpriseReviewedAt: new Date(),
        },
        select: { ...VERSION_SUMMARY_SELECT, content: true },
      });

      const subscriptions = await tx.subscription.findMany({
        where: {
          enterpriseId,
          status: 'ACTIVE',
          employee: { bindings: { some: { capabilityId } } },
        },
        select: { id: true },
      });
      for (const subscription of subscriptions) {
        await tx.subscriptionSkillVersion.upsert({
          where: {
            subscriptionId_capabilityId: { subscriptionId: subscription.id, capabilityId },
          },
          create: {
            subscriptionId: subscription.id,
            capabilityId,
            versionId: created.id,
            selectedById: userId,
          },
          update: { versionId: created.id, selectedById: userId },
        });
      }
      return created;
    });
  }

  /**
   * 管理员把自己的企业版草稿直接发布并生效。
   *
   * 取代了「提交审核 → 自己批准」这两步 —— 会议否掉提审流之后，管理员自己建的草稿
   * 再走一遍自审是纯仪式：批准人和提交人是同一个人。管理员编辑企业版是会议 §6.3
   * 明确要的能力（*企业可以在本企业范围内编辑优化*），与个人副本那条路径并行存在。
   */
  async publishEnterpriseVersion(userId: string, versionId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);

    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, scope: 'ENTERPRISE', enterpriseId: ctx.enterpriseId },
      select: { id: true, capabilityId: true, status: true, version: true },
    });
    if (!version) throw new NotFoundException('企业版本不存在');
    // PENDING_ENTERPRISE_REVIEW 也放进来：提审流删掉之后，存量卡在「待企业审核」的
    // 版本没有别的出路，不接受它们等于把那些数据永久锁死在界面上。
    const publishable = ['DRAFT', 'ENTERPRISE_REJECTED', 'PENDING_ENTERPRISE_REVIEW'];
    if (!publishable.includes(version.status)) {
      throw new ConflictException('只有草稿可以发布');
    }

    const published = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.skillVersion.update({
        where: { id: version.id },
        data: {
          status: 'ENTERPRISE_APPROVED',
          enterpriseReviewedById: userId,
          enterpriseReviewedAt: new Date(),
          rejectionReason: null,
        },
        select: VERSION_SUMMARY_SELECT,
      });

      const subscriptions = await tx.subscription.findMany({
        where: {
          enterpriseId: ctx.enterpriseId,
          status: 'ACTIVE',
          employee: { bindings: { some: { capabilityId: version.capabilityId } } },
        },
        select: { id: true },
      });
      for (const subscription of subscriptions) {
        await tx.subscriptionSkillVersion.upsert({
          where: {
            subscriptionId_capabilityId: {
              subscriptionId: subscription.id,
              capabilityId: version.capabilityId,
            },
          },
          create: {
            subscriptionId: subscription.id,
            capabilityId: version.capabilityId,
            versionId: version.id,
            selectedById: userId,
          },
          update: { versionId: version.id, selectedById: userId },
        });
      }
      return { version: updated, affectedSubscriptions: subscriptions.length };
    });

    await this.notifySkillVersionUpdated(
      ctx.enterpriseId,
      version.capabilityId,
      version.version,
    );
    return published;
  }

  /**
   * diff 的比较基线：企业已通过的最新版本，没有就退到最新平台版。
   *
   * 与 resolveEffectiveVersion 的区别：那个按订阅解析「这条雇佣关系用哪版」，
   * 这个回答「本企业的公共基准是什么」—— 个人改动应该对着企业基准比，
   * 而不是对着某一条订阅的选版比。
   */
  private async resolveEnterpriseBaseline(enterpriseId: string, capabilityId: string) {
    const enterpriseVersion = await this.prisma.skillVersion.findFirst({
      where: {
        capabilityId,
        scope: 'ENTERPRISE',
        enterpriseId,
        status: 'ENTERPRISE_APPROVED',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, scope: true, version: true, content: true },
    });
    if (enterpriseVersion) return enterpriseVersion;

    return this.prisma.skillVersion.findFirst({
      where: { capabilityId, scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, scope: true, version: true, content: true },
    });
  }

  /** 个人副本的归属校验。只有本人能改自己的副本，管理员也不能代改。 */
  private async getOwnedPersonalVersion(userId: string, versionId: string) {
    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, scope: 'PERSONAL', ownerId: userId },
    });
    if (!version) throw new NotFoundException('个人副本不存在');
    if (version.status !== 'PERSONAL_ACTIVE') {
      throw new ConflictException('该副本已归档，不能再编辑');
    }
    return version;
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
            // 列表页按员工分组，分组头要显示成「一个人」而不是一个标签 ——
            // 头像与职能就是那点拟人效果的全部数据来源。
            //
            // 副标题用 functionalCategory 而不是 position：存量数据里 54 个员工有 50 个
            // position 与 name 完全相同、48 个 industry 是「通用」，照那两个字段渲染
            // 会得到「性能基准测试专家 · 通用」压在标题「性能基准测试专家」下面。
            // position/industry 仍然返回，前端只在它们确实带信息时才显示。
            avatar: true,
            position: true,
            industry: true,
            functionalCategory: true,
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
      employees: Array<{
        employeeId: string;
        employeeName: string;
        employeeAvatar: string | null;
        employeePosition: string;
        employeeIndustry: string;
        employeeCategory: string;
        subscriptionId: string;
      }>;
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
          employeeAvatar: subscription.employee.avatar,
          employeePosition: subscription.employee.position,
          employeeIndustry: subscription.employee.industry,
          employeeCategory: subscription.employee.functionalCategory,
          subscriptionId: subscription.id,
        });
        // 已有条目时，企业选版优先于模板默认版
        const explicit = selected.get(capabilityId);
        if (explicit) entry.currentVersion = explicit;
        byCapability.set(capabilityId, entry);
      }
    }

    const capabilityIds = [...byCapability.keys()];
    if (capabilityIds.length === 0) {
      // summary 必须恒定返回 —— 前端顶部汇总条读它，缺字段时会静默不渲染，
      // 看起来像「汇总条没做」而不是「一个技能都没有」
      return {
        canManage: ctx.role === 'ENTERPRISE_ADMIN',
        summary: {
          capabilityCount: 0,
          customizedCount: 0,
          pendingAdoptionTotal: 0,
          totalRounds: 0,
        },
        items: [],
      };
    }

    // 每个能力的调用轮次与使用人数，一次 groupBy 拿全，避免 N+1
    const [roundsByCapability, executions] = await Promise.all([
      this.prisma.toolExecution.groupBy({
        by: ['capabilityId'],
        where: {
          capabilityId: { in: capabilityIds },
          session: {
            user: { memberships: { some: { enterpriseId: ctx.enterpriseId } } },
            employee: {
              subscriptions: { some: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' } },
            },
          },
        },
        _count: { _all: true },
      }),
      this.prisma.toolExecution.findMany({
        where: {
          capabilityId: { in: capabilityIds },
          session: {
            user: { memberships: { some: { enterpriseId: ctx.enterpriseId } } },
            employee: {
              subscriptions: { some: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' } },
            },
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

    // 个人副本：列表页要回答「有几条改动等我处理」和「我自己有没有副本」。
    // 一次查全部再在内存里分组 —— 一个企业的个人副本总数是「成员数 × 能力数」量级，
    // 不会大到需要分页；换成 N 次 count 反而变 N+1。
    const personalVersions = await this.prisma.skillVersion.findMany({
      where: {
        capabilityId: { in: capabilityIds },
        scope: 'PERSONAL',
        status: 'PERSONAL_ACTIVE',
        enterpriseId: ctx.enterpriseId,
      },
      select: {
        id: true,
        capabilityId: true,
        ownerId: true,
        updatedAt: true,
        adoptedInto: { select: { adoptedAt: true }, orderBy: { adoptedAt: 'desc' }, take: 1 },
      },
    });

    const pendingMap = new Map<string, number>();
    const myVersionMap = new Map<string, string>();
    for (const version of personalVersions) {
      // 「待采纳」= 从没被采纳过，或采纳之后又改了一次。
      // 只看「有没有采纳记录」会漏掉改了第二次的人。
      const lastAdoptedAt = version.adoptedInto[0]?.adoptedAt;
      if (!lastAdoptedAt || version.updatedAt > lastAdoptedAt) {
        pendingMap.set(version.capabilityId, (pendingMap.get(version.capabilityId) ?? 0) + 1);
      }
      if (version.ownerId === userId) myVersionMap.set(version.capabilityId, version.id);
    }

    const items = [...byCapability.values()].map((entry) => ({
      capability: entry.capability,
      employees: entry.employees,
      currentVersion: entry.currentVersion,
      usage: {
        totalRounds: roundsMap.get(entry.capability.id) ?? 0,
        distinctUserCount: userCountMap.get(entry.capability.id) ?? 0,
      },
      /// 管理员：有多少条成员改动等着处理。普通成员看到的是自己那条（0 或 1）。
      pendingAdoptionCount: ctx.role === 'ENTERPRISE_ADMIN'
        ? pendingMap.get(entry.capability.id) ?? 0
        : (myVersionMap.has(entry.capability.id) &&
            pendingMap.get(entry.capability.id) ? 1 : 0),
      /// 我自己的副本 id。有值时列表页显示「我的副本已生效」而不是「跟随企业版」。
      myPersonalVersionId: myVersionMap.get(entry.capability.id) ?? null,
    }));

    return {
      canManage: ctx.role === 'ENTERPRISE_ADMIN',
      // 顶部汇总条的四个数由同一接口给出 —— 前端再打一遍请求算同样的东西没有意义
      summary: {
        capabilityCount: items.length,
        customizedCount: items.filter((i) => i.currentVersion?.scope === 'ENTERPRISE').length,
        pendingAdoptionTotal: items.reduce((sum, i) => sum + i.pendingAdoptionCount, 0),
        totalRounds: items.reduce((sum, i) => sum + i.usage.totalRounds, 0),
      },
      items,
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

    const [capability, versions, selection, subscriptions] = await Promise.all([
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
        where: { subscriptionId_capabilityId: { subscriptionId: subscription.id, capabilityId } },
        select: { versionId: true, selectedAt: true },
      }),
      this.prisma.subscription.findMany({
        where: {
          enterpriseId: ctx.enterpriseId,
          status: 'ACTIVE',
          employee: { bindings: { some: { capabilityId } } },
        },
        select: {
          id: true,
          employee: { select: { id: true, name: true } },
          skillVersionSelections: {
            where: { capabilityId },
            select: { versionId: true, selectedAt: true },
          },
        },
      }),
    ]);

    if (!capability) throw new NotFoundException('能力不存在');

    return {
      capability,
      subscriptionId: subscription.id,
      subscriptions: subscriptions.map((item) => ({
        subscriptionId: item.id,
        employeeId: item.employee.id,
        employeeName: item.employee.name,
        currentVersionId: item.skillVersionSelections[0]?.versionId ?? null,
        selectedAt: item.skillVersionSelections[0]?.selectedAt?.toISOString() ?? null,
      })),
      canManage: ctx.role === 'ENTERPRISE_ADMIN',
      currentVersionId:
        selection?.versionId ?? null,
      selectedAt:
        selection?.selectedAt?.toISOString() ?? null,
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
  async getUsageSummary(userId: string, capabilityId: string) {
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
          employee: {
            subscriptions: { some: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' } },
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
    if (ctx.role === 'ENTERPRISE_ADMIN') {
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
   * 某个硅基员工在本企业的使用情况（会议纪要2 §6.2）。
   *
   * 与 getUsageSummary 的区别是入口维度：那个从技能进（这个技能几个人在用），
   * 这个从员工进（这位员工谁在用、用得怎么样）。会议两个视角都要 ——
   * *进「我的企业」能看到硅基员工列表；点进硅基员工能看到使用情况跟踪*。
   *
   * 授权校验用「本企业有这位员工的 ACTIVE 订阅且当前成员被授权」，
   * 与 assertCapabilityVisible 同一套判据，只是换成按员工查。
   */
  async getEmployeeUsage(userId: string, employeeId: string, days = 30) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        enterpriseId: ctx.enterpriseId,
        status: 'ACTIVE',
        employeeId,
        grants: { some: this.activeGrantWhere(ctx.memberId, ctx.departmentId) },
      },
      select: { id: true },
    });
    if (!subscription) throw new ForbiddenException('未获得该硅基员工的使用授权');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sessions = await this.prisma.conversationSession.findMany({
      where: {
        employeeId,
        createdAt: { gte: since },
        // 只算本企业成员的会话 —— 同一个员工模板可能被多家企业雇佣
        user: { memberships: { some: { enterpriseId: ctx.enterpriseId } } },
      },
      select: {
        id: true,
        userId: true,
        source: true,
        updatedAt: true,
        user: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
      },
    });

    const sessionIds = sessions.map((session) => session.id);
    const executions = sessionIds.length
      ? await this.prisma.toolExecution.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { id: true, sessionId: true, status: true, duration: true },
        })
      : [];

    const execBySession = new Map<string, { total: number; success: number }>();
    for (const exec of executions) {
      const entry = execBySession.get(exec.sessionId) ?? { total: 0, success: 0 };
      entry.total += 1;
      if (exec.status === 'SUCCESS') entry.success += 1;
      execBySession.set(exec.sessionId, entry);
    }

    const byMemberMap = new Map<
      string,
      { name: string | null; conversations: number; rounds: number; executions: number; lastUsedAt: Date }
    >();
    for (const session of sessions) {
      if (!session.userId) continue;
      const entry = byMemberMap.get(session.userId) ?? {
        name: session.user?.name ?? null,
        conversations: 0,
        rounds: 0,
        executions: 0,
        lastUsedAt: session.updatedAt,
      };
      entry.conversations += 1;
      entry.rounds += session._count.messages;
      entry.executions += execBySession.get(session.id)?.total ?? 0;
      if (session.updatedAt > entry.lastUsedAt) entry.lastUsedAt = session.updatedAt;
      byMemberMap.set(session.userId, entry);
    }

    const successCount = executions.filter((e) => e.status === 'SUCCESS').length;
    const durations = executions
      .map((e) => e.duration)
      .filter((d): d is number => typeof d === 'number');

    return {
      period: { days, since: since.toISOString() },
      summary: {
        distinctUserCount: byMemberMap.size,
        totalConversations: sessions.length,
        totalRounds: sessions.reduce((sum, s) => sum + s._count.messages, 0),
        totalExecutions: executions.length,
        // 成功率：没有执行记录时给 null 而不是 0% —— 「没跑过」和「全失败」是两件事
        successRate: executions.length ? Math.round((successCount / executions.length) * 100) : null,
        avgDurationMs: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null,
        lastUsedAt:
          sessions.length
            ? sessions.reduce((max, s) => (s.updatedAt > max ? s.updatedAt : max), sessions[0].updatedAt).toISOString()
            : null,
      },
      // 按人列出「谁在用」。含成员对话内容的明细仍只给管理员，这里只有计数，
      // 所以普通成员也能看到 —— 会议要的是「使用人数即口碑」，人数本身不敏感。
      byMember: Array.from(byMemberMap.entries())
        .map(([memberUserId, data]) => ({
          userId: memberUserId,
          userName: data.name,
          conversations: data.conversations,
          rounds: data.rounds,
          executions: data.executions,
          lastUsedAt: data.lastUsedAt.toISOString(),
        }))
        .sort((a, b) => b.rounds - a.rounds),
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
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
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
          employee: {
            subscriptions: { some: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' } },
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

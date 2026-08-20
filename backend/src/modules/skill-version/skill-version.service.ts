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
    if (version.status !== 'DRAFT') {
      throw new ConflictException('只有草稿版本可以编辑');
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
    const numeric = versions
      .map(({ version }) => version.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number))
      .filter((parts): parts is number[] => Boolean(parts))
      .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
    if (numeric.length === 0) return '1.0.0';
    const [major, minor, patch] = numeric[0];
    return `${major}.${minor}.${patch + 1}`;
  }

  private stripFrontmatter(content: string) {
    return matter(content).content.trimStart();
  }
}

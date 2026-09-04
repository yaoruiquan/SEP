import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CapabilityType,
  ContributionPlatformStatus,
  ContributionReviewStatus,
  Prisma,
  SkillVersionScope,
  SkillVersionStatus,
} from '@prisma/client';
import matter from 'gray-matter';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import type {
  ContributionCapabilityCreateDto,
  ContributionCapabilityUpdateDto,
  ContributionReviewDecision as ContributionDecisionDto,
  ContributionVersionCreateDto,
  ContributionVersionUpdateDto,
} from 'shared';
import { SkillPackageService } from '../skill-package/skill-package.service';
import {
  PLATFORM_PROMOTION_SOURCE_SELECT,
  buildPlatformPromotion,
  platformPromotionSummary,
} from '../skill-version/promote-to-platform';
import { nextSemver } from '../skill-version/skill-version-numbering';
import { AUTHOR_VERSION_SELECT, CONTRIBUTION_CAPABILITY_SELECT, CONTRIBUTION_PLATFORM_DETAIL_SELECT, CONTRIBUTION_PLATFORM_LIST_SELECT, USAGE_VERSION_SELECT } from './capability-contribution.types';
import { CapabilityValidatorService } from './capability-validator.service';

const CAPABILITY_TYPES: Record<ContributionCapabilityCreateDto['type'], CapabilityType> = {
  skill: 'SKILL',
  agent: 'AGENT',
};

@Injectable()
export class CapabilityContributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseContext: EnterpriseContextService,
    private readonly validator: CapabilityValidatorService,
    private readonly skillPackage: SkillPackageService,
  ) {}

  async overview(userId: string) {
    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    const canReviewEnterprise = ctx?.role === 'ENTERPRISE_ADMIN';
    const capabilities = await this.prisma.capability.findMany({
      where: canReviewEnterprise
        ? { OR: [{ contributorId: userId }, { enterpriseId: ctx.enterpriseId }] }
        : { contributorId: userId },
      select: {
        enterpriseReviewStatus: true,
        platformReviewStatus: true,
        visibility: true,
        usageCount: true,
      },
    });
    const rewards = await this.prisma.contributionRewardEvent.aggregate({
      where: { recipientId: userId, status: { in: ['PENDING', 'AVAILABLE'] } },
      _sum: { points: true },
    });
    return {
      enterpriseId: ctx?.enterpriseId ?? null,
      capabilityCount: capabilities.length,
      pendingEnterpriseReview: capabilities.filter((item) => item.enterpriseReviewStatus === 'PENDING').length,
      pendingPlatformAuthorization: capabilities.filter((item) => item.platformReviewStatus === 'REQUESTED').length,
      publicCapabilityCount: capabilities.filter((item) => item.visibility === 'MARKET_PUBLIC').length,
      usageCount: capabilities.reduce((sum, item) => sum + item.usageCount, 0),
      pendingRewardPoints: rewards._sum.points ?? 0,
    };
  }

  async listMine(userId: string) {
    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    return this.prisma.capability.findMany({
      where: ctx?.role === 'ENTERPRISE_ADMIN'
        ? { OR: [{ contributorId: userId }, { enterpriseId: ctx.enterpriseId }] }
        : { contributorId: userId },
      select: CONTRIBUTION_CAPABILITY_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getOne(userId: string, capabilityId: string) {
    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    const capability = await this.prisma.capability.findFirst({
      where: ctx?.role === 'ENTERPRISE_ADMIN'
        ? { id: capabilityId, OR: [{ contributorId: userId }, { enterpriseId: ctx.enterpriseId }] }
        : { id: capabilityId, contributorId: userId },
      select: {
        ...CONTRIBUTION_CAPABILITY_SELECT,
        inputSchema: true,
        outputSchema: true,
        skillVersions: {
          select: {
            ...AUTHOR_VERSION_SELECT,
            rejectionReason: true,
            validationResult: true,
            validatedAt: true,
            createdById: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        contributionRewards: {
          select: { id: true, eventType: true, points: true, amount: true, status: true, createdAt: true, settledAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!capability) throw new NotFoundException('能力不存在或无权访问');
    return capability;
  }

  async usage(userId: string, capabilityId: string) {
    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    if (!ctx?.enterpriseId) return { capability: { id: capabilityId, name: '' }, totalBindings: 0, employees: [] };

    const capability = await this.prisma.capability.findFirst({
      where: ctx.role === 'ENTERPRISE_ADMIN'
        ? { id: capabilityId, OR: [{ contributorId: userId }, { enterpriseId: ctx.enterpriseId }] }
        : { id: capabilityId, enterpriseId: ctx.enterpriseId },
      select: { id: true, name: true },
    });
    if (!capability) throw new NotFoundException('能力不存在或无权访问');

    const memberUsers = await this.prisma.enterpriseMember.findMany({ where: { enterpriseId: ctx.enterpriseId }, select: { userId: true } });
    const userIds = memberUsers.map((member) => member.userId);
    const bindings = await this.prisma.employeeCapabilityBinding.findMany({
      where: { capabilityId },
      select: {
        employee: {
          select: {
            id: true,
            name: true,
            bindings: { where: { capabilityId }, select: { defaultSkillVersion: { select: USAGE_VERSION_SELECT } } },
            subscriptions: {
              where: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' },
              select: {
                id: true,
                skillVersionSelections: { where: { capabilityId }, select: { version: { select: USAGE_VERSION_SELECT }, selectedAt: true } },
              },
              take: 1,
            },
          },
        },
      },
    });

    const employees = await Promise.all(bindings.map(async ({ employee }) => {
      const subscription = employee.subscriptions[0];
      const selection = subscription?.skillVersionSelections[0] ?? null;
      const effectiveVersion = selection?.version ?? employee.bindings[0]?.defaultSkillVersion ?? null;
      const executionWhere = { capabilityId, session: { employeeId: employee.id, userId: { in: userIds } } };
      const [usageCount, latestExecution] = await Promise.all([
        this.prisma.toolExecution.count({ where: executionWhere }),
        this.prisma.toolExecution.findFirst({ where: executionWhere, select: { createdAt: true }, orderBy: { createdAt: 'desc' } }),
      ]);
      return {
        employeeId: employee.id,
        employeeName: employee.name,
        subscriptionId: subscription?.id ?? null,
        selectedVersion: selection?.version ?? null,
        effectiveVersion,
        lastUsedAt: latestExecution?.createdAt ?? null,
        usageCount,
      };
    }));
    return { capability, totalBindings: employees.length, employees };
  }

  async create(userId: string, dto: ContributionCapabilityCreateDto) {
    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    if (dto.type === 'skill' && !dto.skillConfig) {
      throw new BadRequestException('Skill 能力必须提供正文模板或上传 SKILL 包');
    }
    if (dto.type === 'agent' && !dto.agentConfig) {
      throw new BadRequestException('Agent 能力必须提供执行平台配置');
    }

    // 正文来源在这里收敛成一份：上传路径按 sha256 重新解包，在线编写路径剥
    // frontmatter。后面写 SkillConfig 与首版 SkillVersion 都用这一份，
    // 两处不会漂移。
    const skill = dto.skillConfig
      ? await this.resolveSkillSource({
          body: dto.skillConfig.template,
          packageSha256: dto.skillConfig.packageSha256,
          packageFilename: dto.skillConfig.packageFilename,
        })
      : null;

    return this.prisma.capability.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: CAPABILITY_TYPES[dto.type],
        industry: dto.industry,
        position: dto.position,
        inputSchema: dto.inputSchema,
        outputSchema: dto.outputSchema,
        contributorId: userId,
        enterpriseId: ctx?.enterpriseId ?? null,
        ...(skill && dto.skillConfig && {
          skillConfig: {
            create: {
              template: skill.content,
              modelId: dto.skillConfig.modelId,
              temperature: dto.skillConfig.temperature,
              maxTokens: dto.skillConfig.maxTokens,
            },
          },
          skillVersions: {
            create: {
              scope: ctx ? 'ENTERPRISE' : 'PLATFORM',
              enterpriseId: ctx?.enterpriseId ?? null,
              version: '1.0.0',
              content: skill.content,
              changeSummary: '初始版本',
              status: 'DRAFT',
              createdById: userId,
              ...skill.packageFields,
            },
          },
        }),
        ...(dto.agentConfig && {
          agentConfig: {
            create: {
              platform: dto.agentConfig.platform.toUpperCase() as 'COZE',
              botId: dto.agentConfig.botId,
              workflowUrl: dto.agentConfig.workflowUrl,
              skillName: dto.agentConfig.skillName,
            },
          },
        }),
      },
      select: CONTRIBUTION_CAPABILITY_SELECT,
    });
  }

  async update(userId: string, capabilityId: string, dto: ContributionCapabilityUpdateDto) {
    const capability = await this.getOwnedCapability(userId, capabilityId);
    if (capability.enterpriseReviewStatus === 'PENDING' || capability.platformReviewStatus === 'PENDING_REVIEW') {
      throw new ConflictException('审核中的能力不能编辑');
    }
    if (capability.enterpriseReviewStatus === 'APPROVED' && capability.visibility === 'MARKET_PUBLIC') {
      throw new ConflictException('已公开能力不能直接修改，请创建新版本');
    }
    return this.prisma.capability.update({
      where: { id: capability.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.industry !== undefined && { industry: dto.industry }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.inputSchema !== undefined && { inputSchema: dto.inputSchema }),
        ...(dto.outputSchema !== undefined && { outputSchema: dto.outputSchema }),
        ...(capability.enterpriseReviewStatus === 'REJECTED' && {
          enterpriseReviewStatus: 'NOT_SUBMITTED',
          enterpriseRejectionReason: null,
        }),
      },
      select: CONTRIBUTION_CAPABILITY_SELECT,
    });
  }

  async submitEnterpriseReview(userId: string, capabilityId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const capability = await this.getOwnedCapability(userId, capabilityId);
    if (capability.enterpriseId !== ctx.enterpriseId) throw new ForbiddenException('能力不属于当前企业');
    if (!['NOT_SUBMITTED', 'REJECTED'].includes(capability.enterpriseReviewStatus)) {
      throw new ConflictException('当前状态不能提交企业审核');
    }
    const validation = await this.validateCapability(capability.id, capability.type);
    if (!validation.valid) {
      throw new BadRequestException({ message: '自动校验未通过，暂不能提交审核', validation });
    }
    return this.prisma.$transaction(async (tx) => {
      const validatedAt = new Date();
      const updated = await tx.capability.update({
        where: { id: capability.id },
        data: {
          enterpriseReviewStatus: 'PENDING',
          enterpriseRejectionReason: null,
          validationResult: validation,
          validatedAt,
        },
        select: CONTRIBUTION_CAPABILITY_SELECT,
      });
      if (capability.type === 'SKILL') {
        await tx.skillVersion.updateMany({
          where: { capabilityId: capability.id, scope: 'ENTERPRISE', status: { in: ['DRAFT', 'ENTERPRISE_REJECTED'] } },
          data: { status: 'PENDING_ENTERPRISE_REVIEW', submittedAt: validatedAt, rejectionReason: null, validationResult: validation, validatedAt },
        });
      }
      return updated;
    });
  }

  async reviewEnterprise(userId: string, capabilityId: string, dto: ContributionDecisionDto) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertCanApprove(ctx);
    const capability = await this.prisma.capability.findFirst({ where: { id: capabilityId, enterpriseId: ctx.enterpriseId } });
    if (!capability) throw new NotFoundException('能力不存在');
    if (capability.enterpriseReviewStatus !== 'PENDING') throw new ConflictException('只有待企业审核能力可以审核');
    const approved = dto.decision === 'APPROVE';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.capability.update({
        where: { id: capability.id },
        data: {
          enterpriseReviewStatus: approved ? 'APPROVED' : 'REJECTED',
          enterpriseReviewedById: userId,
          enterpriseReviewedAt: new Date(),
          enterpriseRejectionReason: approved ? null : dto.comment,
        },
        select: CONTRIBUTION_CAPABILITY_SELECT,
      });
      if (capability.type === 'SKILL') {
        await tx.skillVersion.updateMany({
          where: { capabilityId: capability.id, scope: 'ENTERPRISE', status: 'PENDING_ENTERPRISE_REVIEW' },
          data: { status: approved ? 'ENTERPRISE_APPROVED' : 'ENTERPRISE_REJECTED', rejectionReason: approved ? null : dto.comment },
        });
      }
      if (approved) {
        await tx.contributionRewardEvent.createMany({
          data: [{
            recipientId: capability.contributorId,
            enterpriseId: capability.enterpriseId,
            capabilityId: capability.id,
            eventType: 'ENTERPRISE_APPROVED',
            points: 10,
            dedupeKey: `enterprise-approved:${capability.id}`,
            metadata: { reviewerId: userId },
          }],
          skipDuplicates: true,
        });
      }
      return updated;
    });
  }

  async requestPlatformReview(userId: string, capabilityId: string) {
    const capability = await this.getOwnedCapability(userId, capabilityId);
    if (capability.enterpriseId && capability.enterpriseReviewStatus !== 'APPROVED') {
      throw new ConflictException('企业审核通过后才能申请平台审核');
    }
    if (!['NOT_SUBMITTED', 'REJECTED'].includes(capability.platformReviewStatus)) {
      throw new ConflictException('当前状态不能申请平台审核');
    }
    const validation = await this.validateCapability(capability.id, capability.type);
    if (!validation.valid) throw new BadRequestException({ message: '自动校验未通过，暂不能申请平台投稿', validation });
    const directPlatformSubmission = !capability.enterpriseId;
    return this.prisma.$transaction(async (tx) => {
      const submittedAt = new Date();
      const updated = await tx.capability.update({
        where: { id: capability.id },
        data: {
          platformReviewStatus: directPlatformSubmission ? 'PENDING_REVIEW' : 'REQUESTED',
          platformSubmittedById: directPlatformSubmission ? userId : null,
          platformSubmittedAt: directPlatformSubmission ? submittedAt : null,
          platformRejectionReason: null,
          validationResult: validation,
          validatedAt: submittedAt,
        },
        select: CONTRIBUTION_CAPABILITY_SELECT,
      });
      // 企业路径这一步只是「发起申请」（REQUESTED），要等企业管理员授权才真的进平台，
      // 所以这里不该动任何版本。以前会把 scope=ENTERPRISE 那几行直接改成
      // PENDING_PLATFORM_REVIEW，于是运营的待审列表里出现一批点通过必然 404 的行
      // —— reviewPlatformVersion 只认 scope=PLATFORM。改到 authorizePlatformSubmission
      // 那步去建平台副本。
      if (capability.type === 'SKILL' && directPlatformSubmission) {
        await tx.skillVersion.updateMany({
          where: {
            capabilityId: capability.id,
            scope: 'PLATFORM',
            status: { in: ['DRAFT', 'PLATFORM_REJECTED'] },
          },
          data: {
            status: 'PENDING_PLATFORM_REVIEW',
            submittedAt,
            validationResult: validation,
            validatedAt: submittedAt,
            rejectionReason: null,
          },
        });
      }
      return updated;
    });
  }

  async authorizePlatformSubmission(userId: string, capabilityId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    const capability = await this.prisma.capability.findFirst({ where: { id: capabilityId, enterpriseId: ctx.enterpriseId } });
    if (!capability) throw new NotFoundException('能力不存在');
    if (capability.enterpriseReviewStatus !== 'APPROVED' || capability.platformReviewStatus !== 'REQUESTED') {
      throw new ConflictException('只有企业审核通过且已发起投稿申请的能力可以授权');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.capability.update({
        where: { id: capability.id },
        data: { platformReviewStatus: 'PENDING_REVIEW', platformSubmittedById: userId, platformSubmittedAt: new Date() },
        select: CONTRIBUTION_CAPABILITY_SELECT,
      });
      if (capability.type === 'SKILL') {
        await this.promoteLatestEnterpriseVersion(tx, capability.id, userId);
      }
      return updated;
    });
  }

  /**
   * 整能力投稿时，把企业最新的那一版复制成平台待审版本。
   *
   * 两处和以前不同，都是原来那套写法留下的坑：
   *   - **复制而不是原地改**：企业那行保持 ENTERPRISE_APPROVED 继续在本企业生效，
   *     平台审核作用在 scope=PLATFORM 的副本上。原地改会让企业版本在自家界面上
   *     显示成「待平台审核」，而且运营点通过会 404。
   *   - **只投最新一版**：原来 updateMany 把该企业所有 ENTERPRISE_APPROVED 版本
   *     一起翻牌，一个改过 9 版的技能会产生 9 条待审记录。投稿投的是当前这一版。
   */
  private async promoteLatestEnterpriseVersion(
    tx: Prisma.TransactionClient,
    capabilityId: string,
    actorId: string,
  ) {
    const source = await tx.skillVersion.findFirst({
      where: {
        capabilityId,
        scope: 'ENTERPRISE',
        status: { in: ['ENTERPRISE_APPROVED', 'PLATFORM_REJECTED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { ...PLATFORM_PROMOTION_SOURCE_SELECT, enterprise: { select: { name: true } } },
    });
    if (!source) return null;

    // 重新投稿（上一轮被驳回）会撞 sourceVersionId 的唯一索引。同一份正文没必要
    // 再复制一份，把上次那条退回待审即可 —— 驳回理由一起清掉，否则界面会同时显示
    // 「待平台审核」和上一轮的驳回原因。
    const existing = await tx.skillVersion.findUnique({
      where: { sourceVersionId: source.id },
      select: { id: true },
    });
    if (existing) {
      return tx.skillVersion.update({
        where: { id: existing.id },
        data: {
          status: 'PENDING_PLATFORM_REVIEW',
          submittedAt: new Date(),
          rejectionReason: null,
        },
      });
    }

    const siblings = await tx.skillVersion.findMany({
      where: { capabilityId, scope: 'PLATFORM', enterpriseId: null },
      select: { version: true },
    });
    const platformParent = await tx.skillVersion.findFirst({
      where: { capabilityId, scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return tx.skillVersion.create({
      data: buildPlatformPromotion({
        source,
        version: nextSemver(siblings.map((row) => row.version)),
        platformParentId: platformParent?.id ?? null,
        status: 'PENDING_PLATFORM_REVIEW',
        actorId,
        changeSummary: platformPromotionSummary({
          enterpriseName: source.enterprise?.name ?? null,
          sourceVersion: source.version,
          sourceSummary: source.changeSummary,
        }),
        now: new Date(),
      }),
    });
  }

  async reviewPlatform(userId: string, capabilityId: string, dto: ContributionDecisionDto) {
    const reviewer = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (reviewer?.role !== 'ADMIN') throw new ForbiddenException('仅平台运营可审核');
    const capability = await this.prisma.capability.findUnique({ where: { id: capabilityId } });
    if (!capability || capability.platformReviewStatus !== 'PENDING_REVIEW') throw new ConflictException('只有待平台审核能力可以审核');
    const approved = dto.decision === 'APPROVE';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.capability.update({
        where: { id: capability.id },
        data: {
          platformReviewStatus: approved ? 'APPROVED' : 'REJECTED',
          visibility: approved ? 'MARKET_PUBLIC' : 'ENTERPRISE_PRIVATE',
          status: approved ? 'APPROVED' : 'REJECTED',
          platformRejectionReason: approved ? null : dto.comment,
        },
        select: CONTRIBUTION_CAPABILITY_SELECT,
      });
      if (capability.type === 'SKILL') {
        await tx.skillVersion.updateMany({
          // 只作用在平台副本上。企业投稿与个人直投现在都产出 scope=PLATFORM 的行，
          // 少了这个 scope 约束，企业那行会被改成 PLATFORM_APPROVED —— 于是出现
          // 「MARKET_PUBLIC 的能力一个平台版本都没有」，别的企业订阅后拿不到正文。
          where: {
            capabilityId: capability.id,
            scope: 'PLATFORM',
            status: 'PENDING_PLATFORM_REVIEW',
          },
          data: { status: approved ? 'PLATFORM_APPROVED' : 'PLATFORM_REJECTED', rejectionReason: approved ? null : dto.comment },
        });
      }
      if (approved) {
        await tx.contributionRewardEvent.createMany({
          data: [{
            recipientId: capability.contributorId,
            enterpriseId: capability.enterpriseId,
            capabilityId: capability.id,
            eventType: 'PLATFORM_APPROVED',
            points: 50,
            dedupeKey: `platform-approved:${capability.id}`,
            metadata: { reviewerId: userId },
          }],
          skipDuplicates: true,
        });
      }
      return updated;
    });
  }

  /**
   * 作者发布新版本。
   *
   * 公开能力不再被冻结：从前这里对 MARKET_PUBLIC 直接抛 Conflict，提示「请从
   * 当前公开版本创建新的企业迭代」，但那条路径没有任何入口 —— 能力一旦通过
   * 平台审核，作者就再也改不动了。现在公开能力照常派生新版本，父版本回落到
   * 当前公开版本，后续走版本级审核（submitVersion）而不是能力级审核。
   */
  async createSkillVersion(userId: string, capabilityId: string, dto: ContributionVersionCreateDto) {
    const capability = await this.getOwnedCapability(userId, capabilityId);
    if (capability.type !== 'SKILL') throw new BadRequestException('只有 Skill 支持版本迭代');

    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    const scope: SkillVersionScope = ctx ? 'ENTERPRISE' : 'PLATFORM';
    const enterpriseId = ctx?.enterpriseId ?? null;

    const parent = await this.resolveParentVersion(capabilityId, dto.parentVersionId, scope, enterpriseId);
    const skill = await this.resolveSkillSource({
      body: dto.content,
      packageSha256: dto.packageSha256,
      packageFilename: dto.packageFilename,
    });
    const siblings = await this.prisma.skillVersion.findMany({
      where: { capabilityId, scope, enterpriseId },
      select: { version: true },
    });

    return this.prisma.skillVersion.create({
      data: {
        capabilityId,
        scope,
        enterpriseId,
        parentVersionId: parent?.id,
        version: nextSemver(siblings.map((row) => row.version)),
        content: skill.content,
        changeSummary: dto.changeSummary,
        status: 'DRAFT',
        createdById: userId,
        ...skill.packageFields,
      },
      select: AUTHOR_VERSION_SELECT,
    });
  }

  /**
   * 父版本：显式指定 > 本作用域最新 > 当前公开版本。
   * 最后那一档是公开能力迭代的入口 —— 企业作者第一次改公开能力时，
   * 本企业还没有任何版本，父版本只能是平台上那个已公开的。
   */
  private async resolveParentVersion(
    capabilityId: string,
    parentVersionId: string | undefined,
    scope: SkillVersionScope,
    enterpriseId: string | null,
  ) {
    if (parentVersionId) {
      const explicit = await this.prisma.skillVersion.findFirst({
        where: { id: parentVersionId, capabilityId },
        select: { id: true },
      });
      if (!explicit) throw new BadRequestException('父版本与能力不匹配');
      return explicit;
    }
    return (
      (await this.prisma.skillVersion.findFirst({
        where: { capabilityId, scope, enterpriseId },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await this.prisma.skillVersion.findFirst({
        where: { capabilityId, scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }))
    );
  }

  /** 作者查看自己某个版本的正文。企业侧那个 preview 要求订阅授权，贡献场景永远拿不到。 */
  async getVersionForAuthor(userId: string, versionId: string) {
    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, capability: { contributorId: userId } },
      select: {
        ...AUTHOR_VERSION_SELECT,
        content: true,
        rejectionReason: true,
        validationResult: true,
        validatedAt: true,
        updatedAt: true,
        capability: { select: { id: true, name: true, description: true, visibility: true } },
      },
    });
    if (!version) throw new NotFoundException('版本不存在或无权访问');
    return version;
  }

  /** 编辑草稿正文。上传来的版本不给改文字 —— 包才是它的正文来源，要改就换包。 */
  async updateVersion(userId: string, versionId: string, dto: ContributionVersionUpdateDto) {
    const version = await this.getEditableVersion(userId, versionId);
    if (version.packageKey) {
      throw new ConflictException('这个版本的正文来自上传的包，请上传新版本替代');
    }
    return this.prisma.skillVersion.update({
      where: { id: version.id },
      data: {
        content: matter(dto.content).content.trimStart(),
        ...(dto.changeSummary !== undefined && { changeSummary: dto.changeSummary }),
      },
      select: { ...AUTHOR_VERSION_SELECT, content: true },
    });
  }

  /**
   * 作者提交版本审核，按作用域分流：企业版本先过企业管理员，个人版本直投平台。
   * 与能力级审核不同 —— 能力级只管首次发布，后续迭代都走这里。
   */
  async submitVersion(userId: string, versionId: string) {
    const version = await this.getEditableVersion(userId, versionId);
    if (!version.changeSummary?.trim()) {
      throw new BadRequestException('请先填写本版本的变更说明');
    }
    const validation = this.validator.validateSkill(version.content);
    if (!validation.valid) {
      throw new BadRequestException({ message: '自动校验未通过，暂不能提交审核', validation });
    }
    const submittedAt = new Date();
    return this.prisma.skillVersion.update({
      where: { id: version.id },
      data: {
        status: version.scope === 'ENTERPRISE' ? 'PENDING_ENTERPRISE_REVIEW' : 'PENDING_PLATFORM_REVIEW',
        submittedAt,
        rejectionReason: null,
        validationResult: validation,
        validatedAt: submittedAt,
      },
      select: AUTHOR_VERSION_SELECT,
    });
  }

  /** 作者名下、且处于可编辑状态（草稿或被驳回）的版本。 */
  private async getEditableVersion(userId: string, versionId: string) {
    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, capability: { contributorId: userId } },
    });
    if (!version) throw new NotFoundException('版本不存在或无权访问');
    const editable: SkillVersionStatus[] = ['DRAFT', 'ENTERPRISE_REJECTED', 'PLATFORM_REJECTED'];
    if (!editable.includes(version.status)) {
      throw new ConflictException('只有草稿或被驳回的版本可以修改');
    }
    return version;
  }

  async rewards(userId: string) {
    return this.prisma.contributionRewardEvent.findMany({
      where: { recipientId: userId },
      select: { id: true, eventType: true, points: true, amount: true, status: true, dedupeKey: true, metadata: true, createdAt: true, settledAt: true, capability: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPlatformQueue(status: ContributionPlatformStatus = 'PENDING_REVIEW', page = 1, pageSize = 20) {
    const where = { platformReviewStatus: status };
    const [items, total] = await Promise.all([
      this.prisma.capability.findMany({
        where,
        select: CONTRIBUTION_PLATFORM_LIST_SELECT,
        orderBy: [{ platformSubmittedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: Math.max(0, page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.capability.count({ where }),
    ]);
    return { items, total, page, pageSize, status };
  }

  async listUnifiedReviewQueue(kind: 'ALL' | 'CAPABILITY' | 'SKILL_VERSION' = 'ALL') {
    const [capabilities, versions] = await Promise.all([
      kind === 'SKILL_VERSION' ? Promise.resolve([]) : this.prisma.capability.findMany({
        where: { platformReviewStatus: 'PENDING_REVIEW' },
        select: { id: true, name: true, type: true, platformReviewStatus: true, platformSubmittedAt: true, enterprise: { select: { id: true, name: true } }, platformSubmittedBy: { select: { id: true, name: true, email: true } }, contributor: { select: { id: true, name: true, email: true } } },
        orderBy: { platformSubmittedAt: 'asc' },
      }),
      kind === 'CAPABILITY' ? Promise.resolve([]) : this.prisma.skillVersion.findMany({
        where: { status: 'PENDING_PLATFORM_REVIEW' },
        // sourceVersion.enterprise 是投稿版本的来源企业。
        // 企业投稿时创建的是 scope=PLATFORM 的新版本，它自身 enterpriseId 为空
        // （它要成为公共版本），来源企业只能顺着 sourceVersionId 往回查 ——
        // 否则运营在审核队列里看到的一律是「个人贡献」，分不清是谁投的。
        select: { id: true, capabilityId: true, version: true, status: true, submittedAt: true, capability: { select: { name: true } }, enterprise: { select: { id: true, name: true } }, sourceVersion: { select: { enterprise: { select: { id: true, name: true } } } }, createdBy: { select: { id: true, name: true, email: true } } },
        orderBy: { submittedAt: 'asc' },
      }),
    ]);
    const items = [
      ...capabilities.map((item) => ({ kind: 'CAPABILITY' as const, id: item.id, capabilityId: item.id, capabilityName: item.name, name: item.name, type: item.type, version: null, status: item.platformReviewStatus, submittedAt: item.platformSubmittedAt, enterprise: item.enterprise, submittedBy: item.platformSubmittedBy ?? item.contributor })),
      ...versions.map((item) => ({ kind: 'SKILL_VERSION' as const, id: item.id, capabilityId: item.capabilityId, capabilityName: item.capability.name, name: `${item.capability.name} v${item.version}`, type: 'SKILL' as const, version: item.version, status: item.status, submittedAt: item.submittedAt, enterprise: item.enterprise ?? item.sourceVersion?.enterprise ?? null, submittedBy: item.createdBy })),
    ].sort((a, b) => +(a.submittedAt ?? 0) - +(b.submittedAt ?? 0));
    return { items, total: items.length };
  }

  async getPlatformSubmission(capabilityId: string) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
      select: CONTRIBUTION_PLATFORM_DETAIL_SELECT,
    });
    if (!capability) throw new NotFoundException('能力不存在');
    return capability;
  }

  /** 作者本人下载某个版本的原始 SKILL 包。 */
  async getVersionPackage(userId: string, versionId: string) {
    const version = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, capability: { contributorId: userId } },
      select: {
        packageKey: true,
        packageFilename: true,
        version: true,
        capability: { select: { name: true } },
      },
    });
    if (!version) throw new NotFoundException('版本不存在或无权访问');
    if (!version.packageKey) {
      throw new NotFoundException('该版本是在线编写的正文，没有可下载的包');
    }
    return {
      key: version.packageKey,
      filename:
        version.packageFilename ||
        `${version.capability.name}-v${version.version}.zip`,
    };
  }

  /**
   * 把「上传包」与「在线编写」两条正文来源归一。
   * 上传路径只信 sha256：正文从磁盘上那份字节重新提取，客户端回传的正文一律不采纳。
   */
  private async resolveSkillSource(source: {
    /** 在线编写的正文。创建能力时叫 template，发布版本时叫 content。 */
    body?: string;
    packageSha256?: string;
    packageFilename?: string;
  }) {
    if (source.packageSha256) {
      const stored = await this.skillPackage.read(source.packageSha256);
      return {
        content: stored.content,
        packageFields: {
          packageKey: stored.key,
          packageSha256: stored.sha256,
          packageFileCount: stored.fileCount,
          packageFilename: source.packageFilename ?? null,
        },
      };
    }
    return {
      content: matter(source.body ?? '').content.trimStart(),
      packageFields: {},
    };
  }

  private async getOwnedCapability(userId: string, capabilityId: string) {
    const capability = await this.prisma.capability.findFirst({ where: { id: capabilityId, contributorId: userId } });
    if (!capability) throw new NotFoundException('能力不存在或无权访问');
    return capability;
  }

  private async validateCapability(capabilityId: string, type: CapabilityType) {
    if (type === 'SKILL') {
      const version = await this.prisma.skillVersion.findFirst({
        // 个人能力使用 PLATFORM 快照，企业能力在企业审核通过后使用
        // ENTERPRISE_APPROVED 快照；平台驳回后两条路径都允许重新投稿。
        where: {
          capabilityId,
          status: { in: ['DRAFT', 'ENTERPRISE_REJECTED', 'ENTERPRISE_APPROVED', 'PLATFORM_REJECTED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      return this.validator.validateSkill(version?.content ?? '');
    }
    const config = await this.prisma.agentConfig.findUnique({
      where: { capabilityId },
      select: { platform: true, botId: true, workflowUrl: true, skillName: true },
    });
    return this.validator.validateAgent(config ?? { platform: '' as never, botId: null, workflowUrl: null, skillName: null });
  }
}

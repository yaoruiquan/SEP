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
  SkillVersionStatus,
} from '@prisma/client';
import matter from 'gray-matter';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import type {
  ContributionCapabilityCreateDto,
  ContributionCapabilityUpdateDto,
  ContributionReviewDecision as ContributionDecisionDto,
  ContributionSkillConfigDto,
  ContributionVersionCreateDto,
} from 'shared';
import { SkillPackageService } from '../skill-package/skill-package.service';
import { CONTRIBUTION_CAPABILITY_SELECT, CONTRIBUTION_PLATFORM_DETAIL_SELECT, CONTRIBUTION_PLATFORM_LIST_SELECT, USAGE_VERSION_SELECT } from './capability-contribution.types';
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
            id: true,
            scope: true,
            enterpriseId: true,
            parentVersionId: true,
            sourceVersionId: true,
            version: true,
            changeSummary: true,
            status: true,
            validationResult: true,
            validatedAt: true,
            createdById: true,
            createdAt: true,
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
      ? await this.resolveSkillSource(dto.skillConfig)
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
      if (capability.type === 'SKILL') {
        await tx.skillVersion.updateMany({
          where: {
            capabilityId: capability.id,
            scope: directPlatformSubmission ? 'PLATFORM' : 'ENTERPRISE',
            status: directPlatformSubmission
              ? { in: ['DRAFT', 'PLATFORM_REJECTED'] }
              : { in: ['ENTERPRISE_APPROVED', 'PLATFORM_REJECTED'] },
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
        await tx.skillVersion.updateMany({
          where: { capabilityId: capability.id, scope: 'ENTERPRISE', status: { in: ['ENTERPRISE_APPROVED', 'PLATFORM_REJECTED'] } },
          data: { status: 'PENDING_PLATFORM_REVIEW' },
        });
      }
      return updated;
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
          // 企业投稿使用 ENTERPRISE 快照，个人直投使用 PLATFORM 版本；
          // 两条路径都必须在平台审核完成后落到同一公共版本状态。
          where: { capabilityId: capability.id, status: 'PENDING_PLATFORM_REVIEW' },
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

  async createSkillVersion(userId: string, capabilityId: string, dto: ContributionVersionCreateDto) {
    const capability = await this.getOwnedCapability(userId, capabilityId);
    if (capability.type !== 'SKILL') throw new BadRequestException('只有 Skill 支持版本迭代');
    if (capability.visibility === 'MARKET_PUBLIC') throw new ConflictException('公开能力请从当前公开版本创建新的企业迭代');
    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    const parent = dto.parentVersionId
      ? await this.prisma.skillVersion.findFirst({ where: { id: dto.parentVersionId, capabilityId } })
      : null;
    const scope = ctx ? 'ENTERPRISE' : 'PLATFORM';
    const enterpriseId = ctx?.enterpriseId ?? null;
    const existing = await this.prisma.skillVersion.count({ where: { capabilityId, scope, enterpriseId } });
    return this.prisma.skillVersion.create({
      data: {
        capabilityId,
        scope,
        enterpriseId,
        parentVersionId: parent?.id,
        version: `1.0.${existing}`,
        content: matter(dto.content).content.trimStart(),
        changeSummary: dto.changeSummary,
        status: 'DRAFT',
        createdById: userId,
      },
      select: { id: true, capabilityId: true, scope: true, enterpriseId: true, parentVersionId: true, version: true, changeSummary: true, status: true, createdAt: true },
    });
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
        select: { id: true, capabilityId: true, version: true, status: true, submittedAt: true, capability: { select: { name: true } }, enterprise: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true, email: true } } },
        orderBy: { submittedAt: 'asc' },
      }),
    ]);
    const items = [
      ...capabilities.map((item) => ({ kind: 'CAPABILITY' as const, id: item.id, capabilityId: item.id, capabilityName: item.name, name: item.name, type: item.type, version: null, status: item.platformReviewStatus, submittedAt: item.platformSubmittedAt, enterprise: item.enterprise, submittedBy: item.platformSubmittedBy ?? item.contributor })),
      ...versions.map((item) => ({ kind: 'SKILL_VERSION' as const, id: item.id, capabilityId: item.capabilityId, capabilityName: item.capability.name, name: `${item.capability.name} v${item.version}`, type: 'SKILL' as const, version: item.version, status: item.status, submittedAt: item.submittedAt, enterprise: item.enterprise, submittedBy: item.createdBy })),
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
  private async resolveSkillSource(config: ContributionSkillConfigDto) {
    if (config.packageSha256) {
      const stored = await this.skillPackage.read(config.packageSha256);
      return {
        content: stored.content,
        packageFields: {
          packageKey: stored.key,
          packageSha256: stored.sha256,
          packageFileCount: stored.fileCount,
          packageFilename: config.packageFilename ?? null,
        },
      };
    }
    return {
      content: matter(config.template ?? '').content.trimStart(),
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

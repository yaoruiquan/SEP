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
  ContributionVersionCreateDto,
} from 'shared';
import { CONTRIBUTION_CAPABILITY_SELECT, CONTRIBUTION_PLATFORM_DETAIL_SELECT, CONTRIBUTION_PLATFORM_LIST_SELECT } from './capability-contribution.types';
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

  async create(userId: string, dto: ContributionCapabilityCreateDto) {
    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    if (dto.type === 'skill' && !dto.skillConfig) {
      throw new BadRequestException('Skill 能力必须提供正文模板');
    }
    if (dto.type === 'agent' && !dto.agentConfig) {
      throw new BadRequestException('Agent 能力必须提供执行平台配置');
    }

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
        ...(dto.skillConfig && {
          skillConfig: {
            create: {
              template: dto.skillConfig.template,
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
              content: matter(dto.skillConfig.template).content.trimStart(),
              changeSummary: '初始版本',
              status: 'DRAFT',
              createdById: userId,
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

  async getPlatformSubmission(capabilityId: string) {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
      select: CONTRIBUTION_PLATFORM_DETAIL_SELECT,
    });
    if (!capability) throw new NotFoundException('能力不存在');
    return capability;
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

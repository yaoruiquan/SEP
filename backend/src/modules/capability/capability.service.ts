import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SkillVersionService } from '../skill-version/skill-version.service';
import { AdapterFactory } from './adapters/adapter.factory';
import {
  AdapterInput,
  AdapterExecutionResult,
  type CapabilityExecutionContext,
} from './adapters/adapter.interface';
import { CapabilityUploadDto } from 'shared';
import matter from 'gray-matter';

// Prisma enum values referenced as strings to avoid importing generated enum
const APPROVED = 'APPROVED' as const;
const REJECTED = 'REJECTED' as const;
const ADMIN_ROLE = 'ADMIN';

// Include shape reused across queries
// ⚠️ 安全:永不返回 agentConfig.apiKey(Coze PAT / Dify 密钥),只返回平台/botId 等非敏感字段
const OWNER_INCLUDE = {
  agentConfig: {
    select: {
      id: true,
      platform: true,
      botId: true,
      workflowUrl: true,
      skillName: true,
      createdAt: true,
      updatedAt: true,
      // apiKey: EXCLUDED — 永不下发到前端/API 响应
    },
  },
  rpaConfig: true,
  skillConfig: true,
  aiAppConfig: true,
  contributor: { select: { id: true, name: true, email: true } },
} as const;

const PUBLIC_INCLUDE = {
  agentConfig: {
    select: {
      id: true,
      platform: true,
      botId: true,
      workflowUrl: true,
      skillName: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  rpaConfig: true,
  skillConfig: { select: { id: true } },
  aiAppConfig: true,
  contributor: { select: { id: true, name: true } },
} as const;

@Injectable()
export class CapabilityService {
  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private skillVersionService: SkillVersionService,
  ) {}

  // ──────────────── Browse / Read ────────────────

  async findAll(opts: {
    type?: string;
    industry?: string;
    position?: string;
    status?: string;
    page: number;
    limit: number;
  }) {
    const { type, industry, position, status, page, limit } = opts;
    const where: any = {};

    // 新贡献能力必须经过平台审核并明确进入市场；历史能力在迁移前没有
    // enterpriseId/visibility 语义，保留旧的 APPROVED 公开行为以兼容存量数据。
    where.OR = [
      { visibility: 'MARKET_PUBLIC', platformReviewStatus: 'APPROVED' },
      { enterpriseId: null, status: APPROVED },
    ];

    if (type) where.type = type.toUpperCase();
    if (industry) where.industry = { has: industry };
    if (position) where.position = { has: position };

    const [total, items] = await Promise.all([
      this.prisma.capability.count({ where }),
      this.prisma.capability.findMany({
        where,
        include: PUBLIC_INCLUDE,
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { total, page, limit, items };
  }

  async findOne(id: string) {
    const cap = await this.prisma.capability.findFirst({
      where: {
        id,
        OR: [
          { visibility: 'MARKET_PUBLIC', platformReviewStatus: 'APPROVED' },
          { enterpriseId: null, status: APPROVED },
        ],
      },
      include: PUBLIC_INCLUDE,
    });
    if (!cap) throw new NotFoundException(`Capability ${id} not found`);
    return cap;
  }

  async findByContributor(contributorId: string) {
    return this.prisma.capability.findMany({
      where: { contributorId },
      include: OWNER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ──────────────── Write (Contributor) ────────────────

  async create(contributorId: string, dto: CapabilityUploadDto & { metadata?: any }) {
    const typeMap: Record<string, string> = {
      agent: 'AGENT', rpa: 'RPA', skill: 'SKILL', 'ai-app': 'AI_APP',
    };

    return this.prisma.capability.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: typeMap[dto.type] as any,
        industry: dto.industry,
        position: dto.position,
        inputSchema: dto.inputSchema,
        outputSchema: dto.outputSchema,
        contributorId,
        metadata: dto.metadata || null,
        // Type-specific config sub-records
        ...(dto.agentConfig && {
          agentConfig: {
            create: {
              platform: dto.agentConfig.platform.toUpperCase() as any,
              botId: dto.agentConfig.botId,
              apiKey: dto.agentConfig.apiKey,
              workflowUrl: dto.agentConfig.workflowUrl,
              skillName: dto.agentConfig.skillName,
            },
          },
        }),
        ...(dto.rpaConfig && {
          rpaConfig: {
            create: {
              platform: dto.rpaConfig.platform.toUpperCase() as any,
              executionMode: dto.rpaConfig.executionMode.toUpperCase() as any,
              packageUrl: dto.rpaConfig.packageUrl,
              configDoc: dto.rpaConfig.configDoc,
            },
          },
        }),
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
              scope: 'PLATFORM',
              version: '1.0.0',
              content: matter(dto.skillConfig.template).content.trimStart(),
              status: 'PENDING_PLATFORM_REVIEW',
              submittedAt: new Date(),
              createdById: contributorId,
              changeSummary: '初始版本',
            },
          },
        }),
        ...(dto.aiAppConfig && {
          aiAppConfig: {
            create: {
              integrationMode: dto.aiAppConfig.integrationMode.toUpperCase() as any,
              apiUrl: dto.aiAppConfig.apiUrl,
              webUrl: dto.aiAppConfig.webUrl,
            },
          },
        }),
      },
      include: OWNER_INCLUDE,
    });
  }

  async update(id: string, requesterId: string, requesterRole: string, dto: Partial<CapabilityUploadDto>) {
    const cap = await this.findOneInternal(id);
    if (cap.contributorId !== requesterId && requesterRole !== ADMIN_ROLE) {
      throw new ForbiddenException('Only the contributor or admin can update this capability');
    }
    const typeMap: Record<string, string> = {
      agent: 'AGENT', rpa: 'RPA', skill: 'SKILL', 'ai-app': 'AI_APP',
    };
    return this.prisma.capability.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description && { description: dto.description }),
        ...(dto.type && { type: typeMap[dto.type] as any }),
        ...(dto.industry && { industry: dto.industry }),
        ...(dto.position && { position: dto.position }),
        ...(dto.inputSchema && { inputSchema: dto.inputSchema }),
        ...(dto.outputSchema && { outputSchema: dto.outputSchema }),
      },
      include: OWNER_INCLUDE,
    });
  }

  async remove(id: string, requesterId: string, requesterRole: string) {
    const cap = await this.findOneInternal(id);
    if (cap.contributorId !== requesterId && requesterRole !== ADMIN_ROLE) {
      throw new ForbiddenException('Only the contributor or admin can delete this capability');
    }
    await this.prisma.capability.delete({ where: { id } });
  }

  // ──────────────── Admin review ────────────────

  async approve(id: string, requesterId: string, requesterRole: string) {
    if (requesterRole !== ADMIN_ROLE) throw new ForbiddenException('Admin role required');
    const cap = await this.findOneInternal(id);
    await this.prisma.$transaction(async (tx) => {
      const reviewedAt = new Date();
      await tx.capability.update({
        where: { id: cap.id },
        data: { status: APPROVED, approvedAt: reviewedAt },
      });
      const versions = await tx.skillVersion.findMany({
        where: {
          capabilityId: cap.id,
          scope: 'PLATFORM',
          status: { in: ['DRAFT', 'PENDING_PLATFORM_REVIEW'] },
        },
        select: { id: true },
      });
      if (versions.length === 0) return;
      await tx.skillVersion.updateMany({
        where: { id: { in: versions.map(({ id }) => id) } },
        data: {
          status: 'PLATFORM_APPROVED',
          platformReviewedById: requesterId,
          platformReviewedAt: reviewedAt,
          rejectionReason: null,
        },
      });
      await tx.skillVersionReview.createMany({
        data: versions.map(({ id }) => ({
          versionId: id,
          actorType: 'PLATFORM',
          decision: 'APPROVE',
          reviewerId: requesterId,
        })),
      });
    });
    return this.findOneInternal(cap.id);
  }

  async reject(id: string, requesterId: string, requesterRole: string, reason?: string) {
    if (requesterRole !== ADMIN_ROLE) throw new ForbiddenException('Admin role required');
    const cap = await this.findOneInternal(id);
    await this.prisma.$transaction(async (tx) => {
      const reviewedAt = new Date();
      await tx.capability.update({
        where: { id: cap.id },
        data: {
          status: REJECTED,
          metadata: { ...(cap.metadata as object ?? {}), rejectionReason: reason ?? '' },
        },
      });
      const versions = await tx.skillVersion.findMany({
        where: {
          capabilityId: cap.id,
          scope: 'PLATFORM',
          status: { in: ['DRAFT', 'PENDING_PLATFORM_REVIEW'] },
        },
        select: { id: true },
      });
      if (versions.length === 0) return;
      await tx.skillVersion.updateMany({
        where: { id: { in: versions.map(({ id }) => id) } },
        data: {
          status: 'PLATFORM_REJECTED',
          platformReviewedById: requesterId,
          platformReviewedAt: reviewedAt,
          rejectionReason: reason ?? '',
        },
      });
      await tx.skillVersionReview.createMany({
        data: versions.map(({ id }) => ({
          versionId: id,
          actorType: 'PLATFORM',
          decision: 'REJECT',
          reviewerId: requesterId,
          comment: reason ?? '',
        })),
      });
    });
    return this.findOneInternal(cap.id);
  }

  async findOneForDownload(id: string, userId: string, userRole: string) {
    const cap = await this.findOneInternal(id);
    const isPubliclyApproved =
      (cap.visibility === 'MARKET_PUBLIC' && cap.platformReviewStatus === 'APPROVED') ||
      // 存量能力在迁移前没有贡献中心的公开状态，继续兼容旧的 APPROVED 公开语义。
      (cap.enterpriseId == null && cap.status === APPROVED);

    // 市场公开能力不应再要求员工 Grant。Grant 只用于企业私有能力的
    // 「已绑定员工可下载」场景；否则平台审核通过的投稿仍会被下载接口挡住。
    if (isPubliclyApproved || userRole === ADMIN_ROLE || cap.contributorId === userId) {
      return cap;
    }

    const member = await this.prisma.enterpriseMember.findFirst({
      where: { userId },
      select: { id: true, enterpriseId: true, departmentId: true },
    });
    if (!member) throw new ForbiddenException('No permission to download this skill');
    const targets: Array<{ memberId?: string; departmentId?: string }> = [
      { memberId: member.id },
    ];
    if (member.departmentId) targets.push({ departmentId: member.departmentId });
    const grant = await this.prisma.employeeGrant.findFirst({
      where: {
        OR: targets,
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        subscription: {
          enterpriseId: member.enterpriseId,
          status: 'ACTIVE',
          employee: { bindings: { some: { capabilityId: id } } },
        },
      },
      select: { id: true },
    });
    if (!grant) throw new ForbiddenException('No permission to download this skill');
    return cap;
  }

  /**
   * 返回统一贡献链路下的 SKILL 包 key。
   *
   * 新投稿把包放在 SkillVersion.packageKey，历史运营投稿仍把 key 放在
   * Capability.metadata.zipPath。下载入口统一走这里，避免市场页继续读取一条
   * 已经不再写入的旧字段而出现「审核通过但 404」。
   */
  async getSkillPackageForDownload(id: string, userId: string, userRole: string) {
    const capability = await this.findOneForDownload(id, userId, userRole);
    if (capability.type !== 'SKILL') {
      throw new NotFoundException('Capability is not a SKILL package');
    }

    const publicReady =
      (capability.visibility === 'MARKET_PUBLIC' && capability.platformReviewStatus === 'APPROVED') ||
      (capability.enterpriseId == null && capability.status === APPROVED);

    const version = publicReady
      ? await this.prisma.skillVersion.findFirst({
          where: {
            capabilityId: id,
            scope: 'PLATFORM',
            status: 'PLATFORM_APPROVED',
            packageKey: { not: null },
          },
          select: { packageKey: true, packageFilename: true, version: true },
          orderBy: { createdAt: 'desc' },
        })
      : await this.prisma.skillVersion.findFirst({
          where: {
            capabilityId: id,
            scope: 'ENTERPRISE',
            status: 'ENTERPRISE_APPROVED',
            packageKey: { not: null },
          },
          select: { packageKey: true, packageFilename: true, version: true },
          orderBy: { createdAt: 'desc' },
        });

    if (version?.packageKey) {
      return {
        key: version.packageKey,
        filename:
          version.packageFilename || `${capability.name}-v${version.version}.zip`,
      };
    }

    const metadata = capability.metadata as { zipPath?: unknown } | null;
    // 旧运营数据的 metadata 包没有版本状态，只能在公开能力或平台管理员
    // 下载时兼容读取；不能让企业投稿的 DRAFT 借旧字段绕过审核。
    const canUseLegacyMetadata = publicReady || userRole === ADMIN_ROLE;
    if (
      canUseLegacyMetadata &&
      typeof metadata?.zipPath === 'string' &&
      metadata.zipPath
    ) {
      return { key: metadata.zipPath, filename: `${capability.name}.zip` };
    }
    throw new NotFoundException('Skill package file not found');
  }

  // ──────────────── Runtime execution (used by conversation layer) ────────────────

  async execute(
    capabilityId: string,
    input: AdapterInput,
    ctx: CapabilityExecutionContext = {},
  ): Promise<AdapterExecutionResult> {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
      include: { agentConfig: true },
    });

    if (!capability) throw new NotFoundException(`Capability ${capabilityId} not found`);
    if (!capability.agentConfig) {
      throw new NotFoundException(`No agent config for capability ${capabilityId}`);
    }

    let skillContent: string | null = null;
    let skillVersionId: string | null = null;

    // SKILL 类能力：解析本次执行该用的版本
    // （个人副本 > 企业选版 > 员工模板默认 > 最新平台审核通过版）
    if (capability.type === 'SKILL' && ctx.subscriptionId) {
      const resolved = await this.skillVersionService.resolveEffectiveVersion(
        ctx.subscriptionId,
        capabilityId,
        ctx.userId,
      );
      if (resolved) {
        skillContent = resolved.content;
        skillVersionId = resolved.id;
      }
    }

    const config = {
      platform: capability.agentConfig.platform,
      botId: capability.agentConfig.botId,
      apiKey: capability.agentConfig.apiKey,
      workflowUrl: capability.agentConfig.workflowUrl,
      skillName: capability.agentConfig.skillName,
      skillContent,
      skillVersionId,
    };

    const adapter = this.adapterFactory.create(config);
    const result = await adapter.execute(input);

    // 版本归因回填：执行结果里带上「实际用的是哪个版本」
    return { ...result, skillVersionId };
  }

  private async findOneInternal(id: string) {
    const cap = await this.prisma.capability.findUnique({
      where: { id },
      include: OWNER_INCLUDE,
    });
    if (!cap) throw new NotFoundException(`Capability ${id} not found`);
    return cap;
  }
}

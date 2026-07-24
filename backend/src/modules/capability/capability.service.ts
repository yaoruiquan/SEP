import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterFactory } from './adapters/adapter.factory';
import { AdapterInput, AdapterExecutionResult } from './adapters/adapter.interface';
import { CapabilityUploadDto } from 'shared';

// Prisma enum values referenced as strings to avoid importing generated enum
const APPROVED = 'APPROVED' as const;
const REJECTED = 'REJECTED' as const;
const ADMIN_ROLE = 'ADMIN';

// Include shape reused across queries
// ⚠️ 安全:永不返回 agentConfig.apiKey(Coze PAT / Dify 密钥),只返回平台/botId 等非敏感字段
const FULL_INCLUDE = {
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

@Injectable()
export class CapabilityService {
  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
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

    // Only filter by APPROVED status if no explicit status is provided
    if (status) {
      where.status = status.toUpperCase();
    } else {
      where.status = APPROVED;
    }

    if (type) where.type = type.toUpperCase();
    if (industry) where.industry = { has: industry };
    if (position) where.position = { has: position };

    const [total, items] = await Promise.all([
      this.prisma.capability.count({ where }),
      this.prisma.capability.findMany({
        where,
        include: FULL_INCLUDE,
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { total, page, limit, items };
  }

  async findOne(id: string) {
    const cap = await this.prisma.capability.findUnique({
      where: { id },
      include: FULL_INCLUDE,
    });
    if (!cap) throw new NotFoundException(`Capability ${id} not found`);
    return cap;
  }

  async findByContributor(contributorId: string) {
    return this.prisma.capability.findMany({
      where: { contributorId },
      include: FULL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ──────────────── Write (Contributor) ────────────────

  async create(contributorId: string, dto: CapabilityUploadDto) {
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
      include: FULL_INCLUDE,
    });
  }

  async update(id: string, requesterId: string, requesterRole: string, dto: Partial<CapabilityUploadDto>) {
    const cap = await this.findOne(id);
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
      include: FULL_INCLUDE,
    });
  }

  async remove(id: string, requesterId: string, requesterRole: string) {
    const cap = await this.findOne(id);
    if (cap.contributorId !== requesterId && requesterRole !== ADMIN_ROLE) {
      throw new ForbiddenException('Only the contributor or admin can delete this capability');
    }
    await this.prisma.capability.delete({ where: { id } });
  }

  // ──────────────── Admin review ────────────────

  async approve(id: string, requesterRole: string) {
    if (requesterRole !== ADMIN_ROLE) throw new ForbiddenException('Admin role required');
    const cap = await this.findOne(id);
    return this.prisma.capability.update({
      where: { id: cap.id },
      data: { status: APPROVED, approvedAt: new Date() },
      include: FULL_INCLUDE,
    });
  }

  async reject(id: string, requesterRole: string, reason?: string) {
    if (requesterRole !== ADMIN_ROLE) throw new ForbiddenException('Admin role required');
    const cap = await this.findOne(id);
    return this.prisma.capability.update({
      where: { id: cap.id },
      data: {
        status: REJECTED,
        metadata: { ...(cap.metadata as object ?? {}), rejectionReason: reason ?? '' },
      },
      include: FULL_INCLUDE,
    });
  }

  // ──────────────── Runtime execution (used by conversation layer) ────────────────

  async execute(capabilityId: string, input: AdapterInput): Promise<AdapterExecutionResult> {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
      include: { agentConfig: true },
    });

    if (!capability) throw new NotFoundException(`Capability ${capabilityId} not found`);
    if (!capability.agentConfig) {
      throw new NotFoundException(`No agent config for capability ${capabilityId}`);
    }

    const config = {
      platform: capability.agentConfig.platform,
      botId: capability.agentConfig.botId,
      apiKey: capability.agentConfig.apiKey,
      workflowUrl: capability.agentConfig.workflowUrl,
      skillName: capability.agentConfig.skillName,
    };

    const adapter = this.adapterFactory.create(config);
    return adapter.execute(input);
  }
}

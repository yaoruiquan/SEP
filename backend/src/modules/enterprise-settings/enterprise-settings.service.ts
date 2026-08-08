import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import {
  UpdateEnterpriseSettingDto,
  EnterpriseSettingView,
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
  CustomRoleView,
  AssignCustomRoleDto,
  CreateApiKeyDto,
  CreateApiKeyResponse,
  ApiKeyView,
  ApiCallLogView,
  ApiCallLogQueryDto,
} from 'shared';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class EnterpriseSettingsService {
  private readonly logger = new Logger(EnterpriseSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: EnterpriseContextService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // EnterpriseSetting
  // ─────────────────────────────────────────────────────────────────────────

  async getSetting(userId: string): Promise<EnterpriseSettingView> {
    const { enterpriseId } = await this.ctx.resolve(userId);
    const row = await this.prisma.enterpriseSetting.findUnique({
      where: { enterpriseId },
    });
    if (!row) {
      // 尚未初始化 — 返回默认值（记录在首次 update 时懒创建）
      return {
        id: '',
        sensitiveWordsEnabled: false,
        sensitiveWords: [],
        ipWhitelist: [],
        sessionTimeoutMinutes: 480,
        forcePasswordRotationDays: null,
        webhookUrl: null,
        webhookSecretConfigured: false,
        updatedAt: new Date(0),
      };
    }
    return this.toSettingView(row);
  }

  async updateSetting(
    userId: string,
    dto: UpdateEnterpriseSettingDto,
  ): Promise<EnterpriseSettingView> {
    const { enterpriseId, role } = await this.ctx.resolve(userId);
    if (role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('仅企业管理员可修改企业设置');
    }

    // 处理 webhookSecret：只在显式传入时更新
    const data: Record<string, unknown> = { ...dto };
    if ('webhookSecret' in dto) {
      if (dto.webhookSecret) {
        data['webhookSecret'] = await bcrypt.hash(dto.webhookSecret, BCRYPT_ROUNDS);
      } else {
        data['webhookSecret'] = null;
      }
    }
    delete data['webhookSecret']; // 上面已处理，防止重复
    if ('webhookSecret' in dto) {
      data['webhookSecret'] = dto.webhookSecret
        ? await bcrypt.hash(dto.webhookSecret, BCRYPT_ROUNDS)
        : null;
    }

    const row = await this.prisma.enterpriseSetting.upsert({
      where: { enterpriseId },
      create: { enterpriseId, ...data },
      update: data,
    });
    return this.toSettingView(row);
  }

  private toSettingView(row: {
    id: string;
    sensitiveWordsEnabled: boolean;
    sensitiveWords: string[];
    ipWhitelist: string[];
    sessionTimeoutMinutes: number;
    forcePasswordRotationDays: number | null;
    webhookUrl: string | null;
    webhookSecret: string | null;
    updatedAt: Date;
  }): EnterpriseSettingView {
    return {
      id: row.id,
      sensitiveWordsEnabled: row.sensitiveWordsEnabled,
      sensitiveWords: row.sensitiveWords,
      ipWhitelist: row.ipWhitelist,
      sessionTimeoutMinutes: row.sessionTimeoutMinutes,
      forcePasswordRotationDays: row.forcePasswordRotationDays,
      webhookUrl: row.webhookUrl,
      webhookSecretConfigured: Boolean(row.webhookSecret),
      updatedAt: row.updatedAt,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CustomRole
  // ─────────────────────────────────────────────────────────────────────────

  async listRoles(userId: string): Promise<CustomRoleView[]> {
    const { enterpriseId } = await this.ctx.resolve(userId);
    const roles = await this.prisma.customRole.findMany({
      where: { enterpriseId },
      include: { _count: { select: { members: true } } },
      orderBy: [{ isBuiltin: 'desc' }, { createdAt: 'asc' }],
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions as any,
      isBuiltin: r.isBuiltin,
      memberCount: r._count.members,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async createRole(userId: string, dto: CreateCustomRoleDto): Promise<CustomRoleView> {
    const { enterpriseId, role } = await this.ctx.resolve(userId);
    if (role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('仅企业管理员可创建角色');
    }
    const created = await this.prisma.customRole.create({
      data: {
        enterpriseId,
        name: dto.name,
        description: dto.description ?? null,
        permissions: dto.permissions,
        isBuiltin: false,
      },
      include: { _count: { select: { members: true } } },
    });
    return {
      id: created.id,
      name: created.name,
      description: created.description,
      permissions: created.permissions as any,
      isBuiltin: created.isBuiltin,
      memberCount: created._count.members,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async updateRole(
    userId: string,
    roleId: string,
    dto: UpdateCustomRoleDto,
  ): Promise<CustomRoleView> {
    const { enterpriseId, role } = await this.ctx.resolve(userId);
    if (role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('仅企业管理员可修改角色');
    }
    const existing = await this.prisma.customRole.findFirst({
      where: { id: roleId, enterpriseId },
    });
    if (!existing) throw new NotFoundException('角色不存在');
    if (existing.isBuiltin) throw new ForbiddenException('内置角色不可修改');

    const updated = await this.prisma.customRole.update({
      where: { id: roleId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.permissions !== undefined && { permissions: dto.permissions }),
      },
      include: { _count: { select: { members: true } } },
    });
    return {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      permissions: updated.permissions as any,
      isBuiltin: updated.isBuiltin,
      memberCount: updated._count.members,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteRole(userId: string, roleId: string): Promise<void> {
    const { enterpriseId, role } = await this.ctx.resolve(userId);
    if (role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('仅企业管理员可删除角色');
    }
    const existing = await this.prisma.customRole.findFirst({
      where: { id: roleId, enterpriseId },
    });
    if (!existing) throw new NotFoundException('角色不存在');
    if (existing.isBuiltin) throw new ForbiddenException('内置角色不可删除');
    // 解绑成员的自定义角色（customRoleId → null，由 DB onDelete: SetNull 处理）
    await this.prisma.customRole.delete({ where: { id: roleId } });
  }

  async assignRoleToMember(
    userId: string,
    memberId: string,
    dto: AssignCustomRoleDto,
  ): Promise<void> {
    const { enterpriseId, role } = await this.ctx.resolve(userId);
    if (role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('仅企业管理员可分配角色');
    }
    // 验证目标成员属于本企业
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { id: memberId, enterpriseId },
    });
    if (!member) throw new NotFoundException('成员不存在');
    // 若指定了 customRoleId，验证角色属于本企业
    if (dto.customRoleId) {
      const customRole = await this.prisma.customRole.findFirst({
        where: { id: dto.customRoleId, enterpriseId },
      });
      if (!customRole) throw new NotFoundException('自定义角色不存在');
    }
    await this.prisma.enterpriseMember.update({
      where: { id: memberId },
      data: { customRoleId: dto.customRoleId },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EnterpriseApiKey
  // ─────────────────────────────────────────────────────────────────────────

  async listApiKeys(userId: string): Promise<ApiKeyView[]> {
    const { enterpriseId } = await this.ctx.resolve(userId);
    const rows = await this.prisma.enterpriseApiKey.findMany({
      where: { enterpriseId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((k) => this.toApiKeyView(k));
  }

  async createApiKey(
    userId: string,
    dto: CreateApiKeyDto,
  ): Promise<CreateApiKeyResponse> {
    const { enterpriseId, role } = await this.ctx.resolve(userId);
    if (role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('仅企业管理员可创建 API 密钥');
    }
    // 生成密钥：sk-ent-<random32hex>
    const rawKey = `sk-ent-${crypto.randomBytes(16).toString('hex')}`;
    const keyPrefix = rawKey.slice(0, 12); // "sk-ent-XXXX"
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

    const created = await this.prisma.enterpriseApiKey.create({
      data: {
        enterpriseId,
        name: dto.name,
        keyPrefix,
        keyHash,
        scopes: dto.scopes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy: userId,
      },
    });

    return {
      id: created.id,
      name: created.name,
      key: rawKey,
      keyPrefix,
      scopes: created.scopes as any,
      expiresAt: created.expiresAt?.toISOString() ?? null,
      createdAt: created.createdAt,
    };
  }

  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const { enterpriseId, role } = await this.ctx.resolve(userId);
    if (role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('仅企业管理员可吊销 API 密钥');
    }
    const existing = await this.prisma.enterpriseApiKey.findFirst({
      where: { id: keyId, enterpriseId },
    });
    if (!existing) throw new NotFoundException('API 密钥不存在');
    if (existing.revokedAt) throw new ForbiddenException('密钥已吊销');
    await this.prisma.enterpriseApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  private toApiKeyView(k: {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdBy: string;
    createdAt: Date;
  }): ApiKeyView {
    const now = new Date();
    const active =
      !k.revokedAt && (!k.expiresAt || k.expiresAt > now);
    return {
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: k.scopes as any,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      active,
      createdBy: k.createdBy,
      createdAt: k.createdAt,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ApiCallLog
  // ─────────────────────────────────────────────────────────────────────────

  async listCallLogs(
    userId: string,
    query: ApiCallLogQueryDto,
  ): Promise<{ items: ApiCallLogView[]; total: number }> {
    const { enterpriseId } = await this.ctx.resolve(userId);
    const where = {
      enterpriseId,
      ...(query.apiKeyId && { apiKeyId: query.apiKeyId }),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from && { gte: new Date(query.from) }),
              ...(query.to && { lte: new Date(query.to) }),
            },
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.apiCallLog.count({ where }),
      this.prisma.apiCallLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      total,
      items: items.map((log) => ({
        id: log.id,
        apiKeyId: log.apiKeyId,
        apiKeyName: null, // 后续可关联查询
        method: log.method,
        path: log.path,
        statusCode: log.statusCode,
        durationMs: log.durationMs,
        ip: log.ip,
        createdAt: log.createdAt,
      })),
    };
  }
}

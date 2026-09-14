import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import * as bcrypt from 'bcrypt';
import { ClientLoginDto, ClientRefreshDto, ClientTokenDto, SETTING_KEYS } from 'shared';

const CLIENT_REFRESH_EXPIRES = '30d';
const CLIENT_ACCESS_EXPIRES_IN = 60 * 60;

export interface ClientAuthResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  enterprise: {
    id: string;
    name: string;
  } | null;
  devices: Array<{
    id: string;
    fingerprint: string;
    platform: string;
    lastSeenAt: Date;
  }>;
}

export interface ClientEmploymentTokenResponse {
  employmentToken: string;
  expiresIn: number;
  employment: {
    id: string;
    name: string;
    templateId: string;
    status: string;
  };
}

export interface ClientEmploymentListItem {
  id: string;
  subscriptionId: string;
  employeeId: string;
  name: string;
  status: string;
  templateVersion: string;
  template: {
    id: string;
    name: string;
    avatar: string | null;
  };
  department: {
    id: string;
    name: string;
  } | null;
  allowedModels: string[];
  upgradeAvailable: boolean;
}

@Injectable()
export class ClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly settingService: SettingService,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  private get jwtSecret(): string {
    return this.config.get('JWT_SECRET') || 'sep-jwt-secret-change-in-production';
  }

  /**
   * P4.1 客户端登录：验证用户身份 + 设备注册/更新
   *
   * 与 Web 登录的区别：
   * 1. 桌面端不用 httpOnly cookie，refresh token 直接返回 body
   * 2. 同时注册/更新设备记录（fingerprint + platform + clientVersion）
   * 3. 检查设备是否被吊销
   */
  async login(dto: ClientLoginDto): Promise<ClientAuthResponse> {
    // 1. 验证用户
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('邮箱或密码错误');

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('邮箱或密码错误');

    // 2. 注册/更新设备
    const device = await this.prisma.device.upsert({
      where: {
        userId_fingerprint: {
          userId: user.id,
          fingerprint: dto.fingerprint,
        },
      },
      create: {
        userId: user.id,
        fingerprint: dto.fingerprint,
        platform: dto.platform,
        clientVersion: dto.clientVersion,
        lastSeenAt: new Date(),
      },
      update: {
        platform: dto.platform,
        clientVersion: dto.clientVersion,
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        revokedAt: true,
      },
    });

    // 3. 检查设备是否被吊销
    if (device.revokedAt) {
      throw new UnauthorizedException('该设备已被吊销，请联系管理员');
    }

    // 4. 签发 access token（短期）和 client-refresh token（长期）
    const accessToken = this.signAccessToken(user);

    const refreshToken = this.jwtService.sign(
      {
        sub: user.id,
        deviceId: device.id,
        type: 'client-refresh',
      },
      { secret: this.jwtSecret, expiresIn: CLIENT_REFRESH_EXPIRES },
    );

    // 5. 查询企业归属
    const membership = await this.prisma.enterpriseMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: {
        enterprise: { select: { id: true, name: true } },
      },
    });

    // 6. 返回设备列表（供客户端管理）
    const devices = await this.prisma.device.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        fingerprint: true,
        platform: true,
        lastSeenAt: true,
      },
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: CLIENT_ACCESS_EXPIRES_IN,
      refreshTokenExpiresIn: 30 * 24 * 60 * 60,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      enterprise: membership?.enterprise || null,
      devices,
    };
  }

  async refreshAccessToken(dto: ClientRefreshDto) {
    let payload: any;
    try {
      payload = this.jwtService.verify(dto.refreshToken, { secret: this.jwtSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'client-refresh' || typeof payload.sub !== 'string' || typeof payload.deviceId !== 'string') {
      throw new UnauthorizedException('Token type must be client-refresh');
    }

    const device = await this.prisma.device.findUnique({
      where: { id: payload.deviceId },
      select: { userId: true, revokedAt: true },
    });
    if (!device || device.revokedAt || device.userId !== payload.sub) {
      throw new UnauthorizedException('Device has been revoked or is invalid');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('User not found');
    const membership = await this.prisma.enterpriseMember.findFirst({
      where: { userId: user.id }, orderBy: { createdAt: 'asc' },
      select: { enterprise: { select: { id: true, name: true } } },
    });
    return {
      accessToken: this.signAccessToken(user),
      accessTokenExpiresIn: CLIENT_ACCESS_EXPIRES_IN,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      enterprise: membership?.enterprise ?? null,
    };
  }

  /**
   * P4.2 雇佣令牌刷新：验证 refresh token + 检查订阅可用性 → 签发短期 client-employment JWT
   *
   * client-employment JWT 包含 userId + enterpriseId + subscriptionId + memberId，
   * 供员工包执行时作为身份凭据。TTL 从系统配置读取（默认 15 分钟）。
   */
  async refreshInstanceToken(dto: ClientTokenDto): Promise<ClientEmploymentTokenResponse> {
    // 1. 验证 refresh token
    let payload: any;
    try {
      payload = this.jwtService.verify(dto.refreshToken, { secret: this.jwtSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'client-refresh') {
      throw new UnauthorizedException('Token type must be client-refresh');
    }

    const userId = payload.sub;
    const deviceId = payload.deviceId;

    // 2. 检查设备是否仍然有效
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { revokedAt: true },
    });
    if (!device) {
      throw new UnauthorizedException('Device not found');
    }
    if (device.revokedAt) {
      throw new UnauthorizedException('Device has been revoked');
    }

    // 3. 检查订阅是否存在且 ACTIVE
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: dto.subscriptionId },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    if (!subscription) {
      throw new NotFoundException(`Subscription ${dto.subscriptionId} not found`);
    }
    if (
      subscription.status !== 'ACTIVE' ||
      (subscription.endDate !== null && subscription.endDate <= new Date())
    ) {
      throw new BadRequestException('Subscription is not active');
    }

    // 4. 检查用户是否属于该企业
    const membership = await this.prisma.enterpriseMember.findUnique({
      where: {
        userId_enterpriseId: {
          userId,
          enterpriseId: subscription.enterpriseId,
        },
      },
      select: { id: true, departmentId: true },
    });
    if (!membership) {
      throw new UnauthorizedException('User does not belong to this enterprise');
    }
    const grant = await this.prisma.employeeGrant.findFirst({
      where: {
        subscriptionId: subscription.id,
        OR: [
          { memberId: membership.id },
          ...(membership.departmentId ? [{ departmentId: membership.departmentId }] : []),
        ],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      select: { id: true },
    });
    if (!grant) throw new UnauthorizedException('User has no active grant for this subscription');

    // 5. 读取 CLIENT_TOKEN_TTL_MINUTES 配置
    const ttlStr = await this.settingService.getEffectiveValue(
      SETTING_KEYS.CLIENT_TOKEN_TTL_MINUTES,
    );
    const ttlMinutes = ttlStr ? parseInt(ttlStr, 10) : 15;
    if (isNaN(ttlMinutes) || ttlMinutes <= 0) {
      throw new BadRequestException('Invalid CLIENT_TOKEN_TTL_MINUTES setting');
    }

    // 6. 签发 client-employment JWT
    const employmentToken = this.jwtService.sign(
      {
        sub: userId,
        enterpriseId: subscription.enterpriseId,
        subscriptionId: subscription.id,
        memberId: membership.id,
        type: 'client-employment',
      },
      { secret: this.jwtSecret, expiresIn: `${ttlMinutes}m` },
    );

    return {
      employmentToken,
      expiresIn: ttlMinutes * 60, // seconds
      employment: {
        id: subscription.id,
        name: subscription.employee.name,
        templateId: subscription.employee.id,
        status: subscription.status,
      },
    };
  }

  /**
   * P4.4 客户端订阅清单：列出当前用户企业的所有 ACTIVE 订阅
   *
   * 返回 ACTIVE 订阅及其模板信息，客户端不需要 config 等管理端信息。
   */
  async listSubscriptions(userId: string): Promise<ClientEmploymentListItem[]> {
    const ctx = await this.enterpriseContext.resolve(userId);
    const grants = await this.prisma.employeeGrant.findMany({
      where: {
        OR: [
          { memberId: ctx.memberId },
          ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : []),
        ],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        subscription: {
          enterpriseId: ctx.enterpriseId,
          status: 'ACTIVE',
          OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
        },
      },
      include: {
        subscription: { include: { employee: { select: { id: true, name: true, avatar: true, version: true } } } },
      },
    });
    const [models, modelConfig] = await Promise.all([
      this.prisma.platformModel.findMany({ where: { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: { modelId: true } }),
      this.prisma.enterpriseModelConfig.findUnique({ where: { enterpriseId: ctx.enterpriseId }, select: { allowedChatModels: true } }),
    ]);
    const enabledModels = models.map((model) => model.modelId);
    const allowedModels = modelConfig?.allowedChatModels?.length
      ? enabledModels.filter((id) => modelConfig.allowedChatModels.includes(id)) : enabledModels;
    const seen = new Set<string>();
    return grants.flatMap((grant) => {
      const sub = grant.subscription;
      if (seen.has(sub.id)) return [];
      seen.add(sub.id);
      return [{
        id: sub.id, subscriptionId: sub.id, employeeId: sub.employeeId,
        name: sub.name ?? sub.employee.name, status: sub.status,
        templateVersion: sub.templateVersion, template: sub.employee,
        department: null, allowedModels,
        upgradeAvailable: sub.employee.version !== sub.templateVersion,
      }];
    });
  }

  async getRuntime(userId: string, subscriptionId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const now = new Date();
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        enterpriseId: ctx.enterpriseId,
        status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gt: now } }],
        grants: {
          some: {
            OR: [
              { memberId: ctx.memberId },
              ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : []),
            ],
            AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
          },
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            description: true,
            avatar: true,
            systemPrompt: true,
            modelId: true,
            maxSteps: true,
            version: true,
            bindings: {
              where: { capability: { type: 'SKILL' } },
              orderBy: { priority: 'asc' },
              select: {
                capability: { select: { id: true, name: true, description: true } },
                defaultSkillVersion: { select: { id: true, version: true, status: true, content: true } },
              },
            },
          },
        },
        skillVersionSelections: {
          select: { capabilityId: true, version: { select: { id: true, version: true, status: true, content: true } } },
        },
      },
    });
    if (!subscription) throw new NotFoundException('Runtime unavailable');

    const enabledModels = await this.prisma.platformModel.findMany({
      where: { enabled: true }, select: { modelId: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    const modelConfig = await this.prisma.enterpriseModelConfig.findUnique({
      where: { enterpriseId: ctx.enterpriseId }, select: { allowedChatModels: true },
    });
    const models = enabledModels.map((m) => m.modelId);
    const allowedModels = modelConfig?.allowedChatModels?.length
      ? models.filter((id) => modelConfig.allowedChatModels.includes(id)) : models;
    const selected = new Map(subscription.skillVersionSelections.map((s) => [s.capabilityId, s.version]));
    const skills = subscription.employee.bindings.flatMap((binding) => {
      const version = selected.get(binding.capability.id) ?? binding.defaultSkillVersion;
      if (!version || !['PLATFORM_APPROVED', 'ENTERPRISE_APPROVED'].includes(version.status)) return [];
      return [{ capabilityId: binding.capability.id, name: binding.capability.name, description: binding.capability.description, versionId: version.id, version: version.version, content: version.content }];
    });
    return {
      manifestVersion: 1,
      subscriptionId: subscription.id,
      templateVersion: subscription.templateVersion,
      employee: { id: subscription.employee.id, name: subscription.employee.name, description: subscription.employee.description, avatar: subscription.employee.avatar, version: subscription.employee.version, maxSteps: subscription.employee.maxSteps },
      runtime: { systemPrompt: subscription.employee.systemPrompt, modelId: subscription.employee.modelId, allowedModels, config: subscription.config ?? null, skills },
    };
  }

  async createTaskMirror(userId: string, body: any) {
    if (!body?.clientTaskId || !body?.clientRunId || !body?.subscriptionId || !body?.title) throw new BadRequestException('Invalid task mirror');
    const ctx = await this.enterpriseContext.resolve(userId);
    const sub = await this.prisma.subscription.findFirst({ where: { id: body.subscriptionId, enterpriseId: ctx.enterpriseId, status: 'ACTIVE', OR: [{ endDate: null }, { endDate: { gt: new Date() } }], grants: { some: { OR: [{ memberId: ctx.memberId }, ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : [])] } } }, select: { id: true } });
    if (!sub) throw new ForbiddenException('Subscription unavailable');
    return this.prisma.clientTaskMirror.upsert({ where: { userId_clientTaskId: { userId, clientTaskId: body.clientTaskId } }, create: { userId, enterpriseId: ctx.enterpriseId, subscriptionId: sub.id, clientTaskId: body.clientTaskId, clientRunId: body.clientRunId, title: String(body.title).slice(0, 200), taskType: body.taskType ?? 'conversation', modelId: body.modelId ?? null, clientVersion: body.clientVersion ?? null }, update: { clientRunId: body.clientRunId, title: String(body.title).slice(0, 200), modelId: body.modelId ?? null, clientVersion: body.clientVersion ?? null } });
  }

  private async ownedMirror(userId: string, id: string) { const row = await this.prisma.clientTaskMirror.findFirst({ where: { id, userId } }); if (!row) throw new NotFoundException('Task not found'); return row; }
  async updateTaskMirror(userId: string, id: string, body: any) { const row = await this.ownedMirror(userId, id); const status = String(body?.status ?? row.status).toUpperCase(); const data: any = { status, progress: Math.max(0, Math.min(100, Number(body?.progress ?? row.progress) || 0)), currentStep: body?.currentStep ?? null, activity: body?.activity ?? null, errorSummary: body?.errorSummary ?? null }; if (status === 'RUNNING' && !row.startedAt) data.startedAt = new Date(); if (['COMPLETED','FAILED','CANCELLED'].includes(status)) data.completedAt = new Date(); return this.prisma.clientTaskMirror.update({ where: { id }, data }); }
  async heartbeatTaskMirror(userId: string, id: string, body: any) { await this.ownedMirror(userId, id); return this.prisma.clientTaskMirror.update({ where: { id }, data: { lastHeartbeatAt: new Date(), progress: body?.progress == null ? undefined : Math.max(0, Math.min(100, Number(body.progress) || 0)), activity: body?.activity ?? undefined } }); }
  async eventTaskMirror(userId: string, id: string, body: any) { const row = await this.ownedMirror(userId, id); const seq = Number(body?.sequence); if (!Number.isInteger(seq) || seq <= row.lastSequence) return row; await this.prisma.clientTaskMirrorEvent.create({ data: { mirrorId: row.id, clientRunId: row.clientRunId, sequence: seq, type: String(body.type ?? 'INFO'), stepKey: body.stepKey ?? null, message: body.message ? String(body.message).slice(0, 1000) : null, progress: body.progress == null ? null : Number(body.progress), occurredAt: body.occurredAt ? new Date(body.occurredAt) : null } }); return this.prisma.clientTaskMirror.update({ where: { id: row.id }, data: { lastSequence: seq, progress: body.progress == null ? undefined : Number(body.progress), lastHeartbeatAt: new Date() } }); }
  async listTaskMirrors(userId: string) { const ctx = await this.enterpriseContext.resolve(userId); return this.prisma.clientTaskMirror.findMany({ where: { enterpriseId: ctx.enterpriseId }, orderBy: { updatedAt: 'desc' }, take: 100 }); }
  async getTaskMirror(userId: string, id: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const row = await this.prisma.clientTaskMirror.findFirst({ where: { id, enterpriseId: ctx.enterpriseId } });
    if (!row) throw new NotFoundException('Task not found');
    const events = await this.prisma.clientTaskMirrorEvent.findMany({ where: { mirrorId: row.id }, orderBy: { sequence: 'asc' } });
    return { ...row, events };
  }

  /** @deprecated Use listSubscriptions during client migration. */
  async listInstances(userId: string): Promise<ClientEmploymentListItem[]> {
    return this.listSubscriptions(userId);
  }

  private signAccessToken(user: { id: string; email: string; role: string }) {
    return this.jwtService.sign(
      { sub: user.id, email: user.email, role: user.role, type: 'access' },
      { secret: this.jwtSecret, expiresIn: CLIENT_ACCESS_EXPIRES_IN },
    );
  }
}

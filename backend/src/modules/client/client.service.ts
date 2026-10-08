import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { withEmployeeAvatar } from '../../common/employee-avatar';
import type { EmployeeAvatarAsset } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { SessionService } from '../auth/session.service';
import { AuthRiskService, LoginAuditContext } from '../auth/auth-risk.service';
import { AuthEventService } from '../auth/auth-event.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { MailService } from '../mail/mail.service';
import { MemberAllowanceQueryService } from '../compute-credit/member-allowance-query.service';
import { PersonalWalletService } from '../personal-wallet/personal-wallet.service';
import { SubscriptionRequestService } from '../subscription-request/subscription-request.service';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  ClientLoginDto,
  ClientRefreshDto,
  ClientTokenDto,
  SETTING_KEYS,
  CreateClientTaskMirrorDto,
  UpdateClientTaskMirrorStatusDto,
  ClientTaskHeartbeatDto,
  ClientTaskEventDto,
  ClientTaskMirrorQueryDto,
  ClientPlatformEmployeeQuery,
  ClientEmployeeAccessRequest,
  ClientPlatformEmployeeListResponse,
} from 'shared';

const CLIENT_ACCESS_EXPIRES_IN = 60 * 60;

export interface ClientAuthResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar: string | null;
    role: string;
  };
  enterprise: {
    id: string;
    name: string;
    logo: string | null;
  } | null;
  devices: Array<{
    id: string;
    fingerprint: string;
    platform: string;
    lastSeenAt: Date;
  }>;
}

export interface ClientComputeBalanceResponse {
  enterprise: Awaited<ReturnType<MemberAllowanceQueryService['getOne']>> | null;
  personal: Awaited<ReturnType<PersonalWalletService['getView']>>;
}

export interface ClientProfileResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar: string | null;
    role: string;
  };
  enterprise: {
    id: string;
    name: string;
    logo: string | null;
  } | null;
}

export interface ClientEmploymentTokenResponse {
  employmentToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
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
    avatarAsset?: EmployeeAvatarAsset | null;
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
    private readonly sessions: SessionService,
    private readonly allowanceQuery: MemberAllowanceQueryService,
    private readonly personalWallet: PersonalWalletService,
    private readonly subscriptionRequests: SubscriptionRequestService,
    @Optional() private readonly risk?: AuthRiskService,
    @Optional() private readonly events?: AuthEventService,
    @Optional() private readonly rateLimit?: AuthRateLimitService,
    @Optional() private readonly mail?: MailService,
  ) {}

  private get jwtSecret(): string {
    return this.config.get<string>('ACCESS_JWT_SECRET') ?? this.config.getOrThrow<string>('JWT_SECRET');
  }

  /**
   * P4.1 客户端登录：验证用户身份 + 设备注册/更新
   *
   * 与 Web 登录的区别：
   * 1. 桌面端不用 httpOnly cookie，refresh token 直接返回 body
   * 2. 同时注册/更新设备记录（fingerprint + platform + clientVersion）
   * 3. 检查设备是否被吊销
   */
  async login(
    dto: ClientLoginDto,
    context: Pick<LoginAuditContext, 'ipAddress' | 'userAgent'> = {},
  ): Promise<ClientAuthResponse> {
    const auditContext: LoginAuditContext = { provider: 'desktop-password', ...context };
    const accountLimit = await this.rateLimit?.isBlocked('login-account', dto.email.trim().toLowerCase(), { limit: 12, windowSeconds: 900 });
    const ipLimit = context.ipAddress ? await this.rateLimit?.isBlocked('login-ip', context.ipAddress, { limit: 30, windowSeconds: 300 }) : undefined;
    if (accountLimit && !accountLimit.allowed || ipLimit && !ipLimit.allowed) {
      await this.events?.record({ action: 'LOGIN_FAILED', success: false, provider: 'desktop-password', ipAddress: context.ipAddress, userAgent: context.userAgent, metadata: { reason: 'rate_limited' } });
      throw new UnauthorizedException('邮箱或密码错误');
    }
    // 1. 验证用户
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { authCredentials: { where: { type: 'LOCAL_PASSWORD' }, take: 1 } },
    });
    if (!user) {
      await this.rateLimit?.consume('login-account', dto.email.trim().toLowerCase(), { limit: 12, windowSeconds: 900 });
      if (context.ipAddress) await this.rateLimit?.consume('login-ip', context.ipAddress, { limit: 30, windowSeconds: 300 });
      await this.risk?.recordAnonymousFailure(auditContext);
      throw new UnauthorizedException('邮箱或密码错误');
    }
    if (user.status === 'DISABLED') {
      await this.rateLimit?.consume('login-account', dto.email.trim().toLowerCase(), { limit: 12, windowSeconds: 900 });
      if (context.ipAddress) await this.rateLimit?.consume('login-ip', context.ipAddress, { limit: 30, windowSeconds: 300 });
      await this.events?.record({ userId: user.id, action: 'LOGIN_FAILED', success: false, provider: 'desktop-password', metadata: { reason: 'account_disabled' } });
      throw new UnauthorizedException('账号已被禁用');
    }

    const credential = user.authCredentials[0];
    const passwordHash = credential?.passwordHash ?? null;
    if (!passwordHash) {
      await this.events?.record({ userId: user.id, action: 'LOGIN_FAILED', success: false, provider: 'desktop-password', metadata: { reason: 'password_credential_missing' } });
      throw new UnauthorizedException('邮箱或密码错误');
    }
    await this.risk?.assertLoginAllowed(user.id, {
      passwordHash,
      failedCount: credential?.failedCount ?? 0,
      lockedUntil: credential?.lockedUntil ?? null,
    }, auditContext);
    const isPasswordValid = await bcrypt.compare(dto.password, passwordHash);
    if (!isPasswordValid) {
      await this.rateLimit?.consume('login-account', dto.email.trim().toLowerCase(), { limit: 12, windowSeconds: 900 });
      if (context.ipAddress) await this.rateLimit?.consume('login-ip', context.ipAddress, { limit: 30, windowSeconds: 300 });
      await this.risk?.recordPasswordFailure(user.id, passwordHash, auditContext);
      throw new UnauthorizedException('邮箱或密码错误');
    }
    await this.risk?.recordPasswordSuccess(user.id);

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

    // 4. 统一认证会话：opaque refresh token 只存数据库 hash，且每次刷新轮换
    const session = await this.sessions.createSession({
      userId: user.id,
      clientType: 'DESKTOP',
      deviceId: device.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      refreshTtlSeconds: this.sessions.getRefreshTtlSeconds('DESKTOP'),
    });
    await this.events?.record({ userId: user.id, action: 'LOGIN_SUCCESS', provider: 'desktop-password', ipAddress: context.ipAddress, userAgent: context.userAgent, sessionId: session.sessionId });
    if (session.isNewDevice && this.mail) {
      void this.mail.sendNewDeviceLogin({
        to: user.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        clientType: 'DESKTOP',
      }).catch((error) => this.events?.record({ userId: user.id, action: 'NEW_DEVICE_NOTIFICATION_FAILED', success: false, provider: 'desktop-password', metadata: { reason: error instanceof Error ? error.message : 'mail_error' } }));
      await this.events?.record({ userId: user.id, action: 'NEW_DEVICE_LOGIN', provider: 'desktop-password', sessionId: session.sessionId, ipAddress: context.ipAddress, userAgent: context.userAgent });
    }
    const accessToken = this.signAccessToken(user, session.sessionId);
    const refreshToken = session.refreshToken;

    // 5. 查询企业归属
    const membership = await this.prisma.enterpriseMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: {
        enterprise: { select: { id: true, name: true, logo: true } },
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
      refreshTokenExpiresIn: this.sessions.getRefreshTtlSeconds('DESKTOP'),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
      },
      enterprise: membership?.enterprise || null,
      devices,
    };
  }

  /**
   * 获取桌面客户端当前账号的展示资料。
   *
   * 客户端登录返回的 access token 与 Web 共用 JwtAuthGuard，因此该接口
   * 只接受 access token，不接受 refresh token；企业归属始终由服务端
   * 根据 userId 解析，不接受客户端传入 enterpriseId。
   */
  async listPlatformEmployees(
    query: ClientPlatformEmployeeQuery,
  ): Promise<ClientPlatformEmployeeListResponse> {
    const keyword = query.keyword?.trim();
    const where: any = {
      status: 'APPROVED',
      ...(query.functionalCategory
        ? { functionalCategory: query.functionalCategory }
        : {}),
      ...(query.capabilityId
        ? {
            bindings: {
              some: {
                capabilityId: query.capabilityId,
                capability: { status: 'APPROVED' },
              },
            },
          }
        : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { description: { contains: keyword, mode: 'insensitive' } },
              { position: { contains: keyword, mode: 'insensitive' } },
              { industry: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy =
      query.sort === 'name_asc'
        ? { name: 'asc' as const }
        : query.sort === 'createdAt_desc'
          ? { createdAt: 'desc' as const }
          : { updatedAt: 'desc' as const };

    const [total, employees] = await Promise.all([
      this.prisma.digitalEmployee.count({ where }),
      this.prisma.digitalEmployee.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          avatar: true,
          avatarStyle: true,
          avatarBindings: true,
          position: true,
          description: true,
          functionalCategory: true,
          status: true,
          updatedAt: true,
          bindings: {
            where: { capability: { status: 'APPROVED' } },
            orderBy: { priority: 'asc' },
            select: {
              capability: {
                select: { id: true, name: true, description: true, type: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: employees.map((employee) => {
        const avatar = withEmployeeAvatar(employee);
        return {
          employeeId: employee.id,
          name: employee.name,
          avatar: avatar.avatarAsset?.portraitUrl ?? avatar.avatar,
          avatarAsset: avatar.avatarAsset,
          position: employee.position,
          description: employee.description,
          functionalCategory: employee.functionalCategory,
          employeeStatus: employee.status,
          availability: 'AVAILABLE' as const,
          canApply: true,
          capabilities: employee.bindings.map(({ capability }) => capability),
          updatedAt: employee.updatedAt.toISOString(),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasNextPage: query.page * query.pageSize < total,
    };
  }

  async createEmployeeAccessRequest(
    userId: string,
    dto: ClientEmployeeAccessRequest,
    idempotencyKey: string,
  ) {
    const ctx = await this.enterpriseContext.resolve(userId);
    let employeeId = dto.employeeId ?? null;
    let requestedSubscriptionId = dto.subscriptionId ?? null;

    if (dto.targetType === 'ENTERPRISE_SUBSCRIPTION') {
      const subscription = await this.prisma.subscription.findFirst({
        where: { id: dto.subscriptionId!, enterpriseId: ctx.enterpriseId },
        select: { id: true, employeeId: true, status: true },
      });
      if (!subscription) throw new NotFoundException('企业订阅不存在');
      if (subscription.status !== 'ACTIVE') {
        throw new BadRequestException('企业订阅当前不可申请使用');
      }
      employeeId = subscription.employeeId;
      requestedSubscriptionId = subscription.id;
    } else {
      const employee = await this.prisma.digitalEmployee.findFirst({
        where: { id: dto.employeeId!, status: 'APPROVED' },
        select: { id: true },
      });
      if (!employee) throw new NotFoundException('平台员工不存在或未上架');
    }

    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          targetType: dto.targetType,
          subscriptionId: requestedSubscriptionId,
          employeeId,
          reason: dto.reason,
          requestedCapabilities: dto.requestedCapabilities,
        }),
      )
      .digest('hex');

    const request = await this.subscriptionRequests.createRequest(
      userId,
      { employeeId: employeeId!, reason: dto.reason },
      {
        targetType: dto.targetType,
        requestedCapabilities: dto.requestedCapabilities,
        idempotencyKey,
        requestFingerprint,
      },
    );
    return this.toClientAccessRequestResponse(request, dto.targetType, requestedSubscriptionId, dto.requestedCapabilities);
  }

  async getEmployeeAccessRequest(userId: string, requestId: string) {
    const request = await this.subscriptionRequests.getClientRequest(userId, requestId);
    return this.toClientAccessRequestResponse(
      request,
      request.clientTargetType === 'PLATFORM_EMPLOYEE' ? 'PLATFORM_EMPLOYEE' : 'ENTERPRISE_SUBSCRIPTION',
      request.subscriptionId,
      Array.isArray(request.requestedCapabilities) ? request.requestedCapabilities as string[] : [],
    );
  }

  private toClientAccessRequestResponse(
    request: any,
    targetType: 'ENTERPRISE_SUBSCRIPTION' | 'PLATFORM_EMPLOYEE',
    requestedSubscriptionId: string | null,
    requestedCapabilities: string[],
  ) {
    const status = request.status === 'CANCELED' ? 'CANCELLED' : request.status;
    const message =
      status === 'APPROVED'
        ? '申请已通过，请重新查询订阅列表'
        : status === 'REJECTED'
          ? request.reviewNote ?? '申请已被拒绝'
          : status === 'CANCELLED'
            ? '申请已取消'
            : '申请已提交，等待企业管理员处理';
    return {
      requestId: request.id,
      status,
      targetType,
      employee: {
        employeeId: request.employee?.id ?? request.employeeId,
        subscriptionId: request.subscriptionId ?? requestedSubscriptionId,
        name: request.employee?.name ?? request.employeeName ?? '',
      },
      requestedCapabilities,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      message,
      ...(request.reviewNote ? { reviewNote: request.reviewNote } : {}),
    };
  }

  async getComputeBalance(userId: string): Promise<ClientComputeBalanceResponse> {
    const [enterpriseContext, personal] = await Promise.all([
      this.enterpriseContext.resolveOrNull(userId),
      this.personalWallet.getView(userId),
    ]);

    return {
      enterprise: enterpriseContext
        ? await this.allowanceQuery.getOne(enterpriseContext.enterpriseId, userId)
        : null,
      personal,
    };
  }

  async getProfile(userId: string): Promise<ClientProfileResponse> {
    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, avatar: true, role: true },
      }),
      this.prisma.enterpriseMember.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { enterprise: { select: { id: true, name: true, logo: true } } },
      }),
    ]);

    if (!user) throw new UnauthorizedException('User not found');

    return {
      user,
      enterprise: membership?.enterprise ?? null,
    };
  }

  async refreshAccessToken(dto: ClientRefreshDto) {
    const current = await this.sessions.validateRefreshToken(dto.refreshToken, 'DESKTOP');
    if (!current.deviceId) {
      throw new UnauthorizedException('Desktop session has no device');
    }

    const device = await this.prisma.device.findUnique({
      where: { id: current.deviceId },
      select: { userId: true, revokedAt: true },
    });
    if (!device || device.revokedAt || device.userId !== current.userId) {
      await this.sessions.revokeSession(current.sessionId, 'device_revoked');
      throw new UnauthorizedException('Device has been revoked or is invalid');
    }

    const rotated = await this.sessions.rotateRefreshToken(dto.refreshToken, 'DESKTOP');
    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const membership = await this.prisma.enterpriseMember.findFirst({
      where: { userId: user.id }, orderBy: { createdAt: 'asc' },
      select: { enterprise: { select: { id: true, name: true, logo: true } } },
    });
    return {
      accessToken: this.signAccessToken(user, rotated.sessionId),
      refreshToken: rotated.refreshToken,
      accessTokenExpiresIn: CLIENT_ACCESS_EXPIRES_IN,
      refreshTokenExpiresIn: this.sessions.getRefreshTtlSeconds('DESKTOP'),
      user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, role: user.role },
      enterprise: membership?.enterprise ?? null,
    };
  }

  async logout(dto: ClientRefreshDto): Promise<void> {
    const revoked = await this.sessions.revokeRefreshToken(dto.refreshToken, 'logout');
    if (revoked) await this.events?.record({ userId: revoked.userId, action: 'LOGOUT', sessionId: revoked.sessionId, provider: 'desktop' });
  }

  /**
   * P4.2 雇佣令牌刷新：验证 refresh token + 检查订阅可用性 → 签发短期 client-employment JWT
   *
   * client-employment JWT 包含 userId + enterpriseId + subscriptionId + memberId，
   * 供员工包执行时作为身份凭据。TTL 从系统配置读取（默认 15 分钟）。
   */
  async refreshInstanceToken(dto: ClientTokenDto): Promise<ClientEmploymentTokenResponse> {
    // 1. 验证统一 opaque refresh token，并检查设备是否仍然有效
    const session = await this.sessions.validateRefreshToken(dto.refreshToken, 'DESKTOP');
    const userId = session.userId;
    const deviceId = session.deviceId;
    if (!deviceId) throw new UnauthorizedException('Desktop session has no device');

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { revokedAt: true },
    });
    if (!device) {
      throw new UnauthorizedException('Device not found');
    }
    if (device.revokedAt) {
      await this.sessions.revokeSession(session.sessionId, 'device_revoked');
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

    // 6. 轮换桌面 Refresh Token，再签发短期 employment JWT。
    // 该接口历史上只校验 refresh token，会形成可无限复用的认证旁路；
    // 现在与普通桌面刷新保持同一 Rotation 语义，客户端必须保存新 token。
    const rotated = await this.sessions.rotateRefreshToken(dto.refreshToken, 'DESKTOP');
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
      refreshToken: rotated.refreshToken,
      refreshTokenExpiresIn: this.sessions.getRefreshTtlSeconds('DESKTOP'),
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
        subscription: { include: { employee: { select: { id: true, name: true, avatar: true, avatarStyle: true, avatarBindings: true, version: true } } } },
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
        templateVersion: sub.templateVersion, template: withEmployeeAvatar(sub.employee),
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
            avatar: true, avatarStyle: true, avatarBindings: true,
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
      employee: withEmployeeAvatar({ id: subscription.employee.id, name: subscription.employee.name, description: subscription.employee.description, avatar: subscription.employee.avatar, avatarStyle: subscription.employee.avatarStyle, avatarBindings: subscription.employee.avatarBindings, version: subscription.employee.version, maxSteps: subscription.employee.maxSteps }),
      runtime: { systemPrompt: subscription.employee.systemPrompt, modelId: subscription.employee.modelId, allowedModels, config: subscription.config ?? null, skills },
    };
  }

  // Serialize read/modify/write against concurrent create, status and event requests.
  // PostgreSQL may abort serializable transactions; bounded retries keep replay safe.
  private async taskMirrorTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'P2034' && code !== 'P2002') throw error;
        if (attempt === 2) throw new ConflictException('Task sync conflict; retry the request');
      }
    }
    throw new ConflictException('Task sync conflict; retry the request');
  }

  async createTaskMirror(userId: string, body: CreateClientTaskMirrorDto) {
    const ctx = await this.enterpriseContext.resolve(userId);
    return this.taskMirrorTransaction(async (tx) => {
      const row = await tx.clientTaskMirror.findUnique({
        where: { userId_clientTaskId: { userId, clientTaskId: body.clientTaskId } },
      });
      if (row && row.enterpriseId !== ctx.enterpriseId) {
        throw new ForbiddenException('Task belongs to another enterprise');
      }
      // Re-authorize even for idempotent replay and subscription changes.
      const now = new Date();
      const sub = await tx.subscription.findFirst({
        where: {
          id: body.subscriptionId,
          enterpriseId: ctx.enterpriseId,
          status: 'ACTIVE',
          OR: [{ endDate: null }, { endDate: { gt: now } }],
          grants: { some: {
            OR: [
              { memberId: ctx.memberId },
              ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : []),
            ],
            AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
          } },
        },
        select: { id: true },
      });
      if (!sub) throw new ForbiddenException('Subscription unavailable');
      if (!row) {
        return tx.clientTaskMirror.create({
          data: {
            userId, enterpriseId: ctx.enterpriseId, subscriptionId: sub.id,
            clientTaskId: body.clientTaskId, clientRunId: body.clientRunId,
            title: body.title, taskType: body.taskType ?? 'conversation',
            modelId: body.modelId ?? null, clientVersion: body.clientVersion ?? null,
          },
        });
      }
      return tx.clientTaskMirror.update({
        where: { id: row.id },
        data: {
          subscriptionId: sub.id, clientRunId: body.clientRunId, title: body.title,
          taskType: body.taskType, modelId: body.modelId, clientVersion: body.clientVersion,
          ...(row.clientRunId === body.clientRunId ? {} : {
            status: 'QUEUED', progress: 0, currentStep: null, activity: null,
            errorSummary: null, startedAt: null, completedAt: null, lastHeartbeatAt: null,
          }),
          // lastSequence is task-wide and must never be reset on a new run.
        },
      });
    });
  }

  private async taskMirrorReadWhere(userId: string, scope?: ClientTaskMirrorQueryDto['scope']) {
    const ctx = await this.enterpriseContext.resolve(userId);
    if (scope === 'enterprise' && ctx.role !== 'ENTERPRISE_ADMIN') {
      throw new ForbiddenException('Only enterprise admins may query enterprise tasks');
    }
    return {
      enterpriseId: ctx.enterpriseId,
      ...(scope === 'mine' || ctx.role !== 'ENTERPRISE_ADMIN' ? { userId } : {}),
    };
  }

  private async ownedMirror(tx: Prisma.TransactionClient, userId: string, enterpriseId: string, id: string) {
    const row = await tx.clientTaskMirror.findFirst({ where: { id, userId, enterpriseId } });
    if (!row) throw new NotFoundException('Task not found');
    return row;
  }

  async updateTaskMirror(userId: string, id: string, body: UpdateClientTaskMirrorStatusDto) {
    const ctx = await this.enterpriseContext.resolve(userId);
    return this.taskMirrorTransaction(async (tx) => {
      const row = await this.ownedMirror(tx, userId, ctx.enterpriseId, id);
      if (body.clientRunId !== undefined && body.clientRunId !== row.clientRunId) {
        throw new ConflictException('Stale client run');
      }
      const now = new Date();
      const data: Prisma.ClientTaskMirrorUpdateInput = { status: body.status };
      if (body.progress !== undefined) data.progress = body.progress;
      if (body.currentStep !== undefined) data.currentStep = body.currentStep;
      if (body.activity !== undefined) data.activity = body.activity;
      if (body.errorSummary !== undefined) data.errorSummary = body.errorSummary;
      if (body.startedAt !== undefined) data.startedAt = body.startedAt ? new Date(body.startedAt) : null;
      else if (body.status === 'RUNNING' && !row.startedAt) data.startedAt = now;
      if (body.completedAt !== undefined) data.completedAt = body.completedAt ? new Date(body.completedAt) : null;
      else if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(body.status)) data.completedAt = row.completedAt ?? now;
      return tx.clientTaskMirror.update({ where: { id }, data });
    });
  }

  async heartbeatTaskMirror(userId: string, id: string, body: ClientTaskHeartbeatDto) {
    const ctx = await this.enterpriseContext.resolve(userId);
    return this.taskMirrorTransaction(async (tx) => {
      await this.ownedMirror(tx, userId, ctx.enterpriseId, id);
      return tx.clientTaskMirror.update({ where: { id }, data: {
        lastHeartbeatAt: new Date(), progress: body.progress, currentStep: body.currentStep,
        activity: body.activity, clientVersion: body.clientVersion,
      } });
    });
  }

  async eventTaskMirror(userId: string, id: string, body: ClientTaskEventDto) {
    const ctx = await this.enterpriseContext.resolve(userId);
    return this.taskMirrorTransaction(async (tx) => {
      const row = await this.ownedMirror(tx, userId, ctx.enterpriseId, id);
      // The task watermark covers all runs, including delayed historical events.
      if (body.sequence <= row.lastSequence) return { ...row, duplicate: true };
      const clientRunId = body.clientRunId ?? row.clientRunId;
      await tx.clientTaskMirrorEvent.create({ data: {
        mirrorId: id, clientRunId, sequence: body.sequence, type: body.type,
        stepKey: body.stepKey, message: body.message, progress: body.progress,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : null,
      } });
      return tx.clientTaskMirror.update({ where: { id }, data: {
        lastSequence: body.sequence,
        // Historical runs may archive text, but cannot mutate the active run's progress.
        ...(clientRunId === row.clientRunId ? { progress: body.progress, lastHeartbeatAt: new Date() } : {}),
      } });
    });
  }

  async listTaskMirrors(userId: string, query: ClientTaskMirrorQueryDto = {}) {
    const where = await this.taskMirrorReadWhere(userId, query.scope);
    const include = { user: { select: { id: true, name: true } } } as const;
    const orderBy = [{ updatedAt: 'desc' }, { id: 'desc' }] as const;
    if (query.page === undefined && query.limit === undefined) {
      return this.prisma.clientTaskMirror.findMany({ where, include, orderBy: [...orderBy], take: 100 });
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    // Prisma skip is a signed 32-bit integer. An out-of-range page is simply empty.
    return this.taskMirrorTransaction(async (tx) => {
      const total = await tx.clientTaskMirror.count({ where });
      const items = skip >= total ? [] : await tx.clientTaskMirror.findMany({
        where, include, orderBy: [...orderBy], skip, take: limit,
      });
      return { items, total, page, limit, hasNextPage: page * limit < total };
    });
  }

  async getTaskMirror(userId: string, id: string) {
    const where = await this.taskMirrorReadWhere(userId);
    const row = await this.prisma.clientTaskMirror.findFirst({
      where: { ...where, id }, include: { user: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException('Task not found');
    const events = await this.prisma.clientTaskMirrorEvent.findMany({
      where: { mirrorId: row.id }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    return { ...row, events };
  }

  /** @deprecated Use listSubscriptions during client migration. */
  async listInstances(userId: string): Promise<ClientEmploymentListItem[]> {
    return this.listSubscriptions(userId);
  }

  private signAccessToken(user: { id: string; email: string; role: string }, sessionId?: string) {
    return this.jwtService.sign(
      { sub: user.id, email: user.email, role: user.role, sid: sessionId, type: 'access' },
      { secret: this.jwtSecret, expiresIn: CLIENT_ACCESS_EXPIRES_IN },
    );
  }
}

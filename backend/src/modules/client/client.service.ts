import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import * as bcrypt from 'bcrypt';
import { ClientLoginDto, ClientTokenDto, SETTING_KEYS } from 'shared';

const CLIENT_REFRESH_EXPIRES = '30d';

export interface ClientAuthResponse {
  accessToken: string;
  refreshToken: string;
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
    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        type: 'access',
      },
      { secret: this.jwtSecret, expiresIn: '1h' },
    );

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
    if (subscription.status !== 'ACTIVE') {
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
      select: { id: true },
    });
    if (!membership) {
      throw new UnauthorizedException('User does not belong to this enterprise');
    }

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
  async listInstances(userId: string): Promise<ClientEmploymentListItem[]> {
    const ctx = await this.enterpriseContext.resolve(userId);

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return subscriptions.map(sub => ({
      id: sub.id,
      name: sub.employee.name,
      status: sub.status,
      templateVersion: sub.templateVersion,
      template: sub.employee,
      department: null,
    }));
  }
}

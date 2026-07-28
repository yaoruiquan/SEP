import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto, LoginDto, AuthResponse } from 'shared';

const REFRESH_COOKIE = 'refresh_token';
const ACCESS_EXPIRES = '1h';
const REFRESH_EXPIRES = '7d';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  // ──────────────── helpers ────────────────

  private get jwtSecret(): string {
    return this.config.get('JWT_SECRET') || 'sep-jwt-secret-change-in-production';
  }

  private signAccess(user: { id: string; email: string; role: string }): string {
    return this.jwtService.sign(
      { sub: user.id, email: user.email, role: user.role, type: 'access' },
      { secret: this.jwtSecret, expiresIn: ACCESS_EXPIRES },
    );
  }

  private signRefresh(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, type: 'refresh' },
      { secret: this.jwtSecret, expiresIn: REFRESH_EXPIRES },
    );
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }

  // ──────────────── public methods ────────────────

  /**
   * 企业自助注册：一次创建「公司 + 创建者」。
   *
   * 四件事必须**同时成功或同时失败**，故包在事务里：
   *   ① User             注册人本人
   *   ② Enterprise       他的公司
   *   ③ EnterpriseMember 把二者绑定，角色 = ENTERPRISE_ADMIN
   *   ④ ComputeAccount   挂在企业上，否则订阅后无处扣费
   *
   * 若不用事务：建了 User 但建企业失败，该用户会卡在"有账号无公司"的
   * 死状态 —— 能登录但什么都干不了，且重新注册会报"邮箱已被占用"。
   *
   * 注意：注册入口只用于「开公司」。第二个人起由管理员在企业管理台
   * 添加，若同事也走注册会创建出第二家公司。
   */
  async register(dto: RegisterDto, res: Response): Promise<AuthResponse> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) throw new ConflictException('邮箱已被注册');

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const { user, enterprise, member } = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email: dto.email, name: dto.name, password: hashedPassword },
        });

        const enterprise = await tx.enterprise.create({
          data: {
            name: dto.enterpriseName,
            // 算力账户与企业同生命周期，一并创建
            computeAccount: { create: { balance: 0 } },
          },
        });

        const member = await tx.enterpriseMember.create({
          data: {
            userId: user.id,
            enterpriseId: enterprise.id,
            // 创建者即首个企业管理员 —— 这个身份无法自行申请，
            // 只能来自"这家公司是我开的"
            role: 'ENTERPRISE_ADMIN',
          },
        });

        return { user, enterprise, member };
      },
    );

    const token = this.signAccess(user);
    this.setRefreshCookie(res, this.signRefresh(user.id));

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      enterprise: { id: enterprise.id, name: enterprise.name },
      roleInEnterprise: member.role,
    };
  }

  async login(dto: LoginDto, res: Response): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('邮箱或密码错误');

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('邮箱或密码错误');

    const token = this.signAccess(user);
    this.setRefreshCookie(res, this.signRefresh(user.id));

    const membership = await this.findMembership(user.id);

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...membership,
    };
  }

  /**
   * 查询用户的企业归属，供登录/刷新返回给前端。
   *
   * 平台运营人员不属于任何企业，返回 null 而非抛错 ——
   * 他们要能登录去运营端，只是访问企业资源时会被 403。
   *
   * MVP 单企业：取最早一条 membership（与 EnterpriseContextService 一致）。
   */
  private async findMembership(userId: string): Promise<{
    enterprise: { id: string; name: string } | null;
    roleInEnterprise: string | null;
  }> {
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        enterprise: { select: { id: true, name: true } },
      },
    });

    if (!member) return { enterprise: null, roleInEnterprise: null };
    return { enterprise: member.enterprise, roleInEnterprise: member.role };
  }

  /**
   * 刷新 access token。前端在页面重载后调它重建内存态，
   * 因此**必须一并返回企业信息** —— 否则刷新页面后侧边栏会失去角色，
   * 菜单项渲染不出来。
   */
  async refresh(
    refreshToken: string | undefined,
  ): Promise<Omit<AuthResponse, 'token'> & { token: string }> {
    if (!refreshToken) throw new UnauthorizedException('No refresh token');

    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, { secret: this.jwtSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid token type');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('User not found');

    const token = this.signAccess(user);
    const membership = await this.findMembership(user.id);

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...membership,
    };
  }

  /** 当前登录用户信息（含企业归属，前端侧边栏与管理台都要用）。 */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatar: true, role: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const membership = await this.findMembership(userId);
    return { ...user, ...membership };
  }

  logout(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });
  }
}

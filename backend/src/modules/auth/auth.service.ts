import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {
  RegisterDto,
  LoginDto,
  AuthResponse,
  RegisterByInvitationDto,
  CreateEnterpriseDto,
} from 'shared';
import { InvitationService } from '../enterprise/invitation.service';
import { DefaultDepartmentsService } from '../enterprise/default-departments.service';

const REFRESH_COOKIE = 'refresh_token';
const ACCESS_EXPIRES = '1h';
const REFRESH_EXPIRES = '7d';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private invitations: InvitationService,
    private defaultDepartments: DefaultDepartmentsService,
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

  /**
   * 铺默认部门树。**吞掉异常**：部门缺了管理员自己能建，
   * 但企业已经建成、邮箱已被占用，此时上抛会让用户既登不进去也重注册不了。
   * 失败只记日志，注册照常返回。
   */
  private async seedDefaultDepartments(enterpriseId: string): Promise<void> {
    try {
      await this.defaultDepartments.createDefaultDepartments(enterpriseId);
    } catch (error) {
      this.logger.error(
        `企业 ${enterpriseId} 默认部门创建失败，企业已建成但部门页为空`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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

    // 默认部门树在事务外铺：它是开箱即用的便利，不是注册的必要条件。
    // 挤进事务会把一个三写的短事务拉成十几条 insert；失败若上抛，
    // 则用户卡在"邮箱已占用但公司没建成"的死状态。
    await this.seedDefaultDepartments(enterprise.id);

    const token = this.signAccess(user);
    this.setRefreshCookie(res, this.signRefresh(user.id));

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      enterprise: { id: enterprise.id, name: enterprise.name },
      roleInEnterprise: member.role,
    };
  }

  /**
   * 受邀注册：凭邀请链接加入**已存在**的企业，不创建新公司。
   *
   * 与 register 的分工：register 是「开公司」，本方法是「入职」。
   * 这是第二个人进入企业的第二条途径（第一条是管理员代建账号），
   * 区别在于密码由本人设置 —— 管理员不接触他人凭据。
   *
   * 校验 email 与邀请记录一致是安全要求，不是体验优化：
   * 否则链接被转发后，任何人都能用它加入企业。
   *
   * 三件事必须同时成功或同时失败，故包在事务里：
   *   ① User                     受邀人本人
   *   ② EnterpriseMember         按邀请里的角色/部门/岗位落地
   *   ③ 邀请标记 ACCEPTED         防止同一链接被重复使用
   *
   * 不建 ComputeAccount —— 它挂在企业上，加入者共用企业的账户。
   */
  async registerByInvitation(
    dto: RegisterByInvitationDto,
    res: Response,
  ): Promise<AuthResponse> {
    const invitation = await this.invitations.findUsableByToken(dto.token);

    const email = dto.email.toLowerCase().trim();
    if (invitation.email !== email) {
      // 措辞不暗示"正确的邮箱是什么"，避免把被邀请人邮箱泄露给持链接的第三方
      throw new UnauthorizedException('邮箱与邀请不匹配');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    // 已有账号的人不该走注册 —— 请其登录后在「加入企业」入口用同一链接
    if (existingUser) {
      throw new ConflictException('邮箱已被注册，请登录后再接受邀请');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const { user, enterprise, member } = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, name: dto.name, password: hashedPassword },
        });

        const member = await tx.enterpriseMember.create({
          data: {
            userId: user.id,
            enterpriseId: invitation.enterpriseId,
            role: invitation.role,
            departmentId: invitation.departmentId,
            position: invitation.position,
          },
        });

        // 条件更新 + count 校验：并发下两个请求同时走到这里，
        // 只有一个能把 PENDING 改掉，另一个 count=0 → 抛错回滚，
        // 避免同一链接建出两个成员
        const claimed = await tx.enterpriseInvitation.updateMany({
          where: { id: invitation.id, status: 'PENDING' },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new ConflictException('该邀请已被使用');
        }

        const enterprise = await tx.enterprise.findUniqueOrThrow({
          where: { id: invitation.enterpriseId },
          select: { id: true, name: true },
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

  /**
   * 无企业归属的账号自行开公司。
   *
   * 对应状态机里 `[无归属] ── 开新公司 ──> [企业管理员]` 这条边：
   * 被前公司移除、或主动离职的人，不该为了开自己的公司而注册第二个邮箱。
   *
   * 与 register 的差别只在于 User 已存在，故建三样而非四样：
   *   ① Enterprise       他的新公司（含 ComputeAccount，否则订阅后无处扣费）
   *   ② EnterpriseMember 角色 = ENTERPRISE_ADMIN
   *   ③ —— 不建 User
   *
   * **已有归属者一律拒绝**：MVP 前端按单企业渲染（取最早一条 membership），
   * 允许一人多企业会让新建的那家成为"看不见的归属"——
   * 数据建了，界面永远进不去。要开新公司先退出当前企业。
   */
  async createEnterprise(
    userId: string,
    dto: CreateEnterpriseDto,
    res: Response,
  ): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const existing = await this.prisma.enterpriseMember.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        '你已归属企业，如需开新公司请先在个人设置中退出当前企业',
      );
    }

    const { enterprise, member } = await this.prisma.$transaction(async (tx) => {
      const enterprise = await tx.enterprise.create({
        data: {
          name: dto.name,
          computeAccount: { create: { balance: 0 } },
        },
      });

      const member = await tx.enterpriseMember.create({
        data: {
          userId: user.id,
          enterpriseId: enterprise.id,
          role: 'ENTERPRISE_ADMIN',
        },
      });

      return { enterprise, member };
    });

    // 同 register：默认部门是便利，不该拖垮开公司流程。见 seedDefaultDepartments
    await this.seedDefaultDepartments(enterprise.id);

    // 重新签发：access token 本身不带企业信息，但前端要靠这个响应
    // 把 store 里的 enterprise 从 null 换成新公司，顺带续一次 refresh
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

import {
  Controller, Post, Get, Body, HttpCode, HttpStatus,
  Query, Request, Response, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  RegisterDto, RegisterDtoSchema, LoginDto, LoginDtoSchema,
  RegisterByInvitationDto, RegisterByInvitationDtoSchema,
  AcceptInvitationDto, AcceptInvitationDtoSchema,
  CreateEnterpriseDto, CreateEnterpriseDtoSchema,
} from 'shared';
import { InvitationService } from '../enterprise/invitation.service';
import { MemberService } from '../enterprise/member.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private invitations: InvitationService,
    private members: MemberService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: '企业自助注册（同时创建公司与首个企业管理员）',
    description:
      '注册的不是个人账号，而是「公司 + 创建者」一并创建。注册人成为该企业的' +
      'ENTERPRISE_ADMIN。第二个人起应由管理员在企业管理台添加，' +
      '若也走注册会创建出另一家公司。',
  })
  @ApiResponse({ status: 201, description: '注册成功；refresh token 写入 httpOnly cookie' })
  @ApiResponse({ status: 400, description: '参数校验失败（如缺少 enterpriseName）' })
  @ApiResponse({ status: 409, description: '邮箱已被注册' })
  async register(
    @Body(new ZodValidationPipe(RegisterDtoSchema)) dto: RegisterDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    return this.authService.register(dto, res);
  }

  @Get('invitations/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '校验邀请 token（公开，无需登录）',
    description:
      '受邀注册页用它展示「你被邀请加入 X 公司」。被邀请人此时还没有账号，' +
      '故不加守卫。只返回展示所需字段，不暴露企业组织结构。',
  })
  @ApiResponse({ status: 200, description: '邀请有效，返回企业与角色信息' })
  @ApiResponse({ status: 400, description: '邀请链接无效或已失效' })
  async verifyInvitation(@Query('token') token: string) {
    return this.invitations.verifyToken(token ?? '');
  }

  @Post('register-by-invitation')
  @ApiOperation({
    summary: '受邀注册（加入已存在的企业，不创建新公司）',
    description:
      '与 /register 的分工：register 是「开公司」，本接口是「入职」。' +
      '密码由受邀人自己设置，管理员不接触他人凭据。' +
      'email 必须与邀请记录一致 —— 否则链接被转发后任何人都能加入企业。',
  })
  @ApiResponse({ status: 201, description: '注册成功并已加入企业' })
  @ApiResponse({ status: 400, description: '邀请链接无效或已失效' })
  @ApiResponse({ status: 401, description: '邮箱与邀请不匹配' })
  @ApiResponse({ status: 409, description: '邮箱已被注册，或邀请已被使用' })
  async registerByInvitation(
    @Body(new ZodValidationPipe(RegisterByInvitationDtoSchema))
    dto: RegisterByInvitationDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    return this.authService.registerByInvitation(dto, res);
  }

  @Post('accept-invitation')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '已登录用户接受邀请（加入企业）',
    description:
      'register-by-invitation 的另一半：那条路径只服务还没有账号的人。' +
      '已有账号者登录后走本接口。挂在 /auth 而非 /enterprise 下，' +
      '因为接受者此刻通常无企业归属，企业上下文会对其抛 403。',
  })
  @ApiResponse({ status: 200, description: '已加入企业' })
  @ApiResponse({ status: 400, description: '邀请无效、已失效，或不是发给当前账号的' })
  @ApiResponse({ status: 409, description: '已是该企业成员，或已归属其他企业' })
  async acceptInvitation(
    @Request() req: ExpressRequest & { user: { id: string } },
    @Body(new ZodValidationPipe(AcceptInvitationDtoSchema))
    dto: AcceptInvitationDto,
  ) {
    return this.invitations.acceptByUser(req.user.id, dto.token);
  }

  @Post('leave-enterprise')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '主动离职（解除企业归属）',
    description: [
      '给「原公司已经不管这事了」兜底：若只有管理员移除这一个入口，',
      '账号会被前雇主的不作为永久卡住 —— 既进不了新企业，也用不了原企业。',
      '',
      '**不需要原企业审批**：需要对方同意才能离职，等于把上面的死锁搬回来。',
      '回收项全在企业侧（席位、部门归属），离职不带走任何数据。',
      '',
      '处置与管理员移除完全一致：回收本人席位授权、取消待审批申请，',
      '保留审批历史/知识库/会话记录。账号保留，转为「无企业归属」。',
      '',
      '唯一管理员不可离职 —— 走掉后企业永久失去管理能力。',
      '',
      '挂在 /auth 而非 /enterprise 下，与 accept-invitation 同理。',
    ].join('\n'),
  })
  @ApiResponse({ status: 200, description: '已离职，返回回收数量与原企业信息' })
  @ApiResponse({ status: 400, description: '当前未归属任何企业' })
  @ApiResponse({ status: 409, description: '你是唯一管理员，需先指定其他管理员' })
  async leaveEnterprise(
    @Request() req: ExpressRequest & { user: { id: string } },
  ) {
    return this.members.leaveEnterprise(req.user.id);
  }

  @Post('create-enterprise')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '无企业归属的账号开新公司',
    description: [
      '状态机里 `[无归属] ── 开新公司 ──> [企业管理员]` 这条边。',
      '被前公司移除或主动离职的人，不该为了开自己的公司而换一个邮箱注册。',
      '',
      '与 /register 的分工：register 建 User + Enterprise（还没有账号的人），',
      '本接口只建 Enterprise + Member + ComputeAccount（账号已存在）。',
      '',
      '已有企业归属者返回 409 —— MVP 前端按单企业渲染，多归属会让',
      '新建的那家成为「看不见的归属」。',
    ].join('\n'),
  })
  @ApiResponse({ status: 201, description: '已创建企业，返回新的企业归属与角色' })
  @ApiResponse({ status: 400, description: '参数校验失败（公司名 2–100 字）' })
  @ApiResponse({ status: 409, description: '已归属企业，需先退出当前企业' })
  async createEnterprise(
    @Request() req: ExpressRequest & { user: { id: string } },
    @Body(new ZodValidationPipe(CreateEnterpriseDtoSchema))
    dto: CreateEnterpriseDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    return this.authService.createEnterprise(req.user.id, dto, res);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登录（返回企业归属与企业内角色）' })
  @ApiResponse({ status: 200, description: 'Login successful; refresh token set in httpOnly cookie' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body(new ZodValidationPipe(LoginDtoSchema)) dto: LoginDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    return this.authService.login(dto, res);
  }

  @Get('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rehydrate in-memory access token from httpOnly cookie' })
  @ApiResponse({ status: 200, description: 'New access token issued' })
  @ApiResponse({ status: 401, description: 'Missing or invalid refresh token' })
  async refresh(@Request() req: ExpressRequest) {
    const refreshToken = req.cookies?.['refresh_token'];
    return this.authService.refresh(refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear refresh token cookie' })
  @ApiResponse({ status: 204, description: 'Logged out' })
  logout(@Response({ passthrough: true }) res: ExpressResponse) {
    this.authService.logout(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Current user' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@Request() req: ExpressRequest & { user: { id: string } }) {
    return this.authService.getMe(req.user.id);
  }
}

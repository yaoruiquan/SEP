import { Body, Controller, Get, HttpCode, Post, Query, Request, Response, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Response as ExpressResponse } from 'express';
import { AccountClosureRequestDto, AccountClosureRequestSchema, AccountClosureTokenDto, AccountClosureTokenSchema, AccountClosureRecoveryDto, AccountClosureRecoverySchema } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AccountClosureService } from './account-closure.service';

@ApiTags('Account Closure')
@Controller('auth/account-closure')
export class AccountClosureController {
  constructor(private readonly closure: AccountClosureService, private readonly config: ConfigService) {}

  @Get('eligibility')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '查看本人账号注销前置条件' })
  @ApiResponse({ status: 200, description: '逐项返回阻塞原因和撤回期天数' })
  @ApiResponse({ status: 401, description: '需登录有效账号' })
  eligibility(@Request() req: { user: { id: string } }) {
    return this.closure.eligibility(req.user.id);
  }

  @Post('verification')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ auth: { ttl: 60000, limit: 3 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '向本人邮箱发送专用注销确认链接' })
  @ApiResponse({ status: 200, description: '邮件已发送，20 分钟内有效' })
  @ApiResponse({ status: 409, description: '不满足注销条件' })
  @ApiResponse({ status: 429, description: '发送过于频繁' })
  @ApiResponse({ status: 503, description: 'SMTP 邮件服务不可用' })
  verification(@Request() req: { user: { id: string } }) {
    return this.closure.requestVerification(req.user.id);
  }

  @Post()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '经邮件身份确认后提交注销申请并撤销全部会话' })
  @ApiResponse({ status: 200, description: '已进入注销撤回期，返回最终执行时间' })
  @ApiResponse({ status: 400, description: '令牌或确认文字无效' })
  @ApiResponse({ status: 409, description: '不满足注销条件或已有申请' })
  @ApiResponse({ status: 503, description: '撤回邮件发送失败，账号保持原状态' })
  async request(
    @Request() req: { user: { id: string } },
    @Body(new ZodValidationPipe(AccountClosureRequestSchema)) dto: AccountClosureRequestDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.closure.request(req.user.id, dto);
    const production = this.config.get('NODE_ENV') === 'production';
    const cookieName = this.config.get<string>('REFRESH_COOKIE_NAME') ?? (production ? '__Host-sep_refresh' : 'refresh_token');
    res.clearCookie(cookieName, {
      httpOnly: true, secure: production || cookieName.startsWith('__Host-'), sameSite: 'lax', path: '/',
    });
    return result;
  }

  @Get('cancel')
  @Throttle({ auth: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: '只读预览专用撤回凭证，不改变账号状态' })
  @ApiResponse({ status: 200, description: '凭证有效，返回撤回截止时间' })
  @ApiResponse({ status: 400, description: '凭证无效或撤回期已结束' })
  preview(@Query(new ZodValidationPipe(AccountClosureTokenSchema)) dto: AccountClosureTokenDto) {
    return this.closure.previewCancellation(dto.token);
  }

  @Post('cancel')
  @HttpCode(200)
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: '使用专用凭证撤回注销申请，不隐式登录' })
  @ApiResponse({ status: 200, description: '账号恢复 ACTIVE，需重新登录' })
  @ApiResponse({ status: 400, description: '凭证已使用、过期或无效' })
  @ApiResponse({ status: 409, description: '账号注销状态不允许撤回' })
  cancel(@Body(new ZodValidationPipe(AccountClosureTokenSchema)) dto: AccountClosureTokenDto) {
    return this.closure.cancel(dto.token);
  }

  @Post('recovery')
  @HttpCode(200)
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: '重发注销撤回邮件，不透露账号或申请是否存在' })
  @ApiResponse({ status: 200, description: '统一返回提示，SMTP 失败不作废旧链接' })
  @ApiResponse({ status: 400, description: '邮箱格式无效' })
  recover(
    @Body(new ZodValidationPipe(AccountClosureRecoverySchema)) dto: AccountClosureRecoveryDto,
    @Request() req: { ip?: string },
  ) {
    return this.closure.recover(dto.email, req.ip);
  }
}

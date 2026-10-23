import { Body, Controller, Get, HttpCode, Post, Request, Response, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Response as ExpressResponse } from 'express';
import { AccountClosureRequestDto, AccountClosureRequestSchema } from 'shared';
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
  @ApiResponse({ status: 200, description: '返回阻塞原因和将同步关闭的企业' })
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
  @ApiOperation({ summary: '经邮件确认后立即注销账号并关闭符合条件的企业' })
  @ApiResponse({ status: 200, description: '账号已注销，返回完成时间及已关闭企业' })
  @ApiResponse({ status: 400, description: '令牌或确认文字无效' })
  @ApiResponse({ status: 409, description: '不满足注销条件或企业归属已变化' })
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
}

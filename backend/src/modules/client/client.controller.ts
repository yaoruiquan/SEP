import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { ClientService } from './client.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ClientLoginDto,
  ClientLoginDtoSchema,
  ClientTokenDto,
  ClientTokenDtoSchema,
} from 'shared';

@ApiTags('Client')
@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  /**
   * P4.1 客户端登录
   * 验证用户身份 + 注册/更新设备 → 返回 accessToken + refreshToken（在 body 中，非 cookie）
   */
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '客户端登录（桌面端专用）',
    description:
      '用邮箱 + 密码登录并注册设备指纹。' +
      '与 Web 登录不同，refresh token 直接返回 body 而非 httpOnly cookie，' +
      '供桌面应用安全存储。',
  })
  @ApiResponse({ status: 200, description: '登录成功，返回 accessToken + refreshToken' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 401, description: '邮箱或密码错误，或设备已被吊销' })
  async login(
    @Body(new ZodValidationPipe(ClientLoginDtoSchema)) dto: ClientLoginDto,
  ) {
    return this.clientService.login(dto);
  }

  /**
   * P4.2 刷新实例令牌
   * 验证 client-refresh token + 检查实例可用 → 签发短期 client-instance JWT
   */
  @Post('auth/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '获取实例令牌',
    description:
      '用 refreshToken + instanceId 换取短期 client-instance JWT。' +
      '有效期由系统配置 CLIENT_TOKEN_TTL_MINUTES 控制（默认 15 分钟）。' +
      '员工包执行时用此令牌作为身份凭据。',
  })
  @ApiResponse({ status: 200, description: '实例令牌签发成功' })
  @ApiResponse({ status: 400, description: '参数校验失败或实例不可用' })
  @ApiResponse({ status: 401, description: 'refresh token 无效或设备已被吊销' })
  @ApiResponse({ status: 404, description: '实例不存在' })
  async refreshInstanceToken(
    @Body(new ZodValidationPipe(ClientTokenDtoSchema)) dto: ClientTokenDto,
  ) {
    return this.clientService.refreshInstanceToken(dto);
  }

  /**
   * P4.4 客户端实例清单
   * 列出当前用户企业的所有 ACTIVE 实例（供客户端展示可用员工列表）
   */
  @Get('instances')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取可用实例列表',
    description:
      '返回当前用户企业内所有状态为 ACTIVE 的员工实例。' +
      '客户端用此列表让用户选择要与之对话的员工。',
  })
  @ApiResponse({ status: 200, description: '实例列表' })
  @ApiResponse({ status: 401, description: '未认证' })
  async listInstances(@Request() req: ExpressRequest & { user: { id: string } }) {
    return this.clientService.listInstances(req.user.id);
  }
}

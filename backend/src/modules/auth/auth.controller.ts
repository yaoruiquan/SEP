import {
  Controller, Post, Get, Body, HttpCode, HttpStatus,
  Request, Response, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto, RegisterDtoSchema, LoginDto, LoginDtoSchema } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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

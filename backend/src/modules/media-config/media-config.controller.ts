import { Body, Controller, Get, Param, Patch, Post, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateMediaProfileDto,
  CreateMediaProfileDtoSchema,
  UpdateMediaConnectionDto,
  UpdateMediaConnectionDtoSchema,
  UpdateMediaPolicyDto,
  UpdateMediaPolicyDtoSchema,
  UpdateMediaProfileDto,
  UpdateMediaProfileDtoSchema,
} from 'shared';
import { MediaConfigService } from './media-config.service';

type AuthedRequest = { user: { id: string } };

@ApiTags('media-config')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: '未认证' })
@ApiResponse({ status: 403, description: '无平台管理或企业访问权限' })
@Controller()
export class MediaConfigController {
  constructor(private readonly service: MediaConfigService) {}

  @Get('admin/media/profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '列出媒体模型 Profile（仅管理员）' })
  @ApiResponse({ status: 200, description: '媒体 Profile 列表；不包含连接密钥' })
  listProfiles() {
    return this.service.listProfiles();
  }

  @Post('admin/media/profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '创建图片媒体模型 Profile（仅管理员）' })
  @ApiResponse({ status: 201, description: '已创建的未验证图片 Profile' })
  @ApiResponse({ status: 400, description: '配置校验失败' })
  @ApiResponse({ status: 409, description: 'Profile ID 已存在' })
  createProfile(@Body(new ZodValidationPipe(CreateMediaProfileDtoSchema)) dto: CreateMediaProfileDto) {
    return this.service.createProfile(dto);
  }

  @Patch('admin/media/profiles/:profileId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '更新图片媒体模型 Profile（仅管理员）' })
  @ApiResponse({ status: 200, description: '更新后的 Profile 与服务端配置版本' })
  @ApiResponse({ status: 400, description: '配置校验失败' })
  @ApiResponse({ status: 404, description: 'Profile 不存在' })
  @ApiResponse({ status: 409, description: '配置版本冲突，请重新加载' })
  updateProfile(
    @Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(UpdateMediaProfileDtoSchema)) dto: UpdateMediaProfileDto,
  ) {
    return this.service.updateProfile(profileId, dto);
  }

  @Get('admin/media/connection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '获取媒体模型连接状态（不返回密钥）' })
  @ApiResponse({ status: 200, description: '媒体连接地址与配置状态；不返回密钥' })
  getConnection() {
    return this.service.getConnection();
  }

  @Put('admin/media/connection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '更新媒体模型连接（仅管理员）' })
  @ApiResponse({ status: 200, description: '保存后的连接状态；留空密钥保留现有值' })
  @ApiResponse({ status: 400, description: '连接配置校验失败' })
  @ApiResponse({ status: 409, description: '并发修改冲突，请重新加载后保存' })
  updateConnection(@Body(new ZodValidationPipe(UpdateMediaConnectionDtoSchema)) dto: UpdateMediaConnectionDto) {
    return this.service.updateConnection(dto);
  }

  @Get('enterprise/media-config')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取当前企业媒体策略' })
  @ApiResponse({ status: 200, description: '企业媒体策略、连接状态与编辑权限' })
  getEnterpriseConfig(@Request() req: AuthedRequest) {
    return this.service.getEnterpriseConfig(req.user.id);
  }

  @Put('enterprise/media-config')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '更新当前企业媒体策略（仅企业管理员）' })
  @ApiResponse({ status: 200, description: '保存后的企业媒体策略' })
  @ApiResponse({ status: 400, description: '允许列表或默认 Profile 无效' })
  @ApiResponse({ status: 409, description: '并发修改冲突，请重新加载后保存' })
  updateEnterpriseConfig(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(UpdateMediaPolicyDtoSchema)) dto: UpdateMediaPolicyDto,
  ) {
    return this.service.updateEnterpriseConfig(req.user.id, dto);
  }

  @Get('enterprise/media-config/available-profiles')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取当前企业可选择的图片 Profile' })
  @ApiResponse({ status: 200, description: '平台已启用且已验证的图片 Profile 列表' })
  getAvailableProfiles(@Request() req: AuthedRequest) {
    return this.service.getAvailableProfiles(req.user.id);
  }
}

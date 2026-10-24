import { Body, Controller, Get, Param, Patch, Post, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateMediaProfileDto,
  CreateMediaProfileDtoSchema,
  DiscoverMediaModelsDtoSchema,
  MediaPolicyPreviewRequest,
  MediaPolicyPreviewRequestSchema,
  UpdateMediaConnectionDto,
  UpdateMediaConnectionDtoSchema,
  UpdateMediaPolicyDto,
  UpdateMediaPolicyDtoSchema,
  UpdateMediaProfileDto,
  UpdateMediaProfileDtoSchema,
  VerifyMediaProfileDto,
  VerifyMediaProfileDtoSchema,
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

  @Post('admin/media/models/discover')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '通过图片连接检测模型并自动同步适配能力，不生成、不自动企业授权' })
  @ApiResponse({ status: 201, description: '模型、适配范围及检测时间；内部配置已自动同步' })
  @ApiResponse({ status: 400, description: '不接受客户端连接凭据或额外参数' })
  @ApiResponse({ status: 409, description: '连接或模型配置在同步期间发生变化' })
  @ApiResponse({ status: 503, description: '连接或模型目录暂不可用' })
  discoverModels(@Body(new ZodValidationPipe(DiscoverMediaModelsDtoSchema)) _dto: Record<string, never>) {
    return this.service.discoverModels();
  }

  @Post('admin/media/profiles/:profileId/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '校验图片 Profile 的模型目录、适配范围和只读报价，不执行生图' })
  @ApiResponse({ status: 201, description: '配置校验结果；executionTested=false，不代表真实生成/编辑验收' })
  @ApiResponse({ status: 400, description: '模型或参数不在支持范围' })
  @ApiResponse({ status: 404, description: 'Profile 不存在' })
  @ApiResponse({ status: 409, description: '配置或媒体连接已变更' })
  @ApiResponse({ status: 503, description: '模型目录或报价不可用' })
  verifyProfile(
    @Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(VerifyMediaProfileDtoSchema)) dto: VerifyMediaProfileDto,
  ) {
    return this.service.verifyProfile(profileId, dto);
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
  updateConnection(@Body(new ZodValidationPipe(UpdateMediaConnectionDtoSchema)) dto: UpdateMediaConnectionDto,
    @Request() req: AuthedRequest) {
    return this.service.updateConnection(dto, req.user.id);
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

  @Post('enterprise/media-config/preview')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '按当前服务端能力预览图片授权草稿，不保存或报价' })
  @ApiResponse({ status: 200, description: 'Profile 有效状态与过滤原因；不返回模型 ID 或连接信息' })
  @ApiResponse({ status: 400, description: '图片授权草稿或协议版本无效' })
  previewEnterpriseConfig(@Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(MediaPolicyPreviewRequestSchema)) dto: MediaPolicyPreviewRequest) {
    return this.service.previewEnterpriseConfig(req.user.id, dto);
  }

  @Get('enterprise/media-config/available-profiles')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取当前企业可选择的图片 Profile' })
  @ApiResponse({ status: 200, description: '平台已启用且已验证的图片 Profile 列表' })
  getAvailableProfiles(@Request() req: AuthedRequest) {
    return this.service.getAvailableProfiles(req.user.id);
  }
}

import { Body, Controller, Get, Param, Patch, Post, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateMediaVideoProfileDto, CreateMediaVideoProfileDtoSchema, DiscoverMediaVideoModelsDtoSchema,
  UpdateMediaVideoPolicyDto, UpdateMediaVideoPolicyDtoSchema, UpdateMediaVideoProfileDto,
  UpdateMediaVideoProfileDtoSchema, VerifyMediaVideoProfileDto, VerifyMediaVideoProfileDtoSchema,
  UpdateMediaConnectionDto, UpdateMediaConnectionDtoSchema,
  MediaVideoPolicyPreviewRequest, MediaVideoPolicyPreviewRequestSchema,
} from 'shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaVideoConfigService } from './media-video-config.service';

@ApiTags('media-video-config')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: '未认证' })
@ApiResponse({ status: 403, description: '无平台管理或企业访问权限' })
@Controller()
export class MediaVideoConfigController {
  constructor(private readonly service: MediaVideoConfigService) {}

  @Get('admin/media/video/connection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '读取独立视频连接及生效来源，不返回密钥' })
  @ApiResponse({ status: 200, description: '视频地址、密钥是否配置及来源' })
  @ApiResponse({ status: 503, description: '视频连接配置不可用' })
  getConnection() { return this.service.getConnection(); }

  @Put('admin/media/video/connection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '保存独立视频连接，空密钥保留当前连接密钥' })
  @ApiResponse({ status: 200, description: '保存后的连接状态，无密钥明文' })
  @ApiResponse({ status: 400, description: '无效连接或缺少密钥' })
  @ApiResponse({ status: 409, description: '并发修改冲突' })
  @ApiResponse({ status: 503, description: '视频连接配置不可用' })
  updateConnection(@Body(new ZodValidationPipe(UpdateMediaConnectionDtoSchema)) dto: UpdateMediaConnectionDto,
    @Request() req: { user: { id: string } }) {
    return this.service.updateConnection(dto, req.user.id);
  }

  @Get('admin/media/video/profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '列出视频模型的内部配置及可用状态' })
  @ApiResponse({ status: 200, description: '视频 Profile 列表，无连接凭据' })
  listProfiles() { return this.service.listProfiles(); }

  @Post('admin/media/video/profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '兼容旧版：创建未启用的视频配置，自动模型标识不可手工创建' })
  @ApiResponse({ status: 201, description: '未启用且未验证的视频 Profile' })
  @ApiResponse({ status: 400, description: '参数无效或尝试直接启用' })
  @ApiResponse({ status: 409, description: 'Profile ID 已存在' })
  createProfile(@Body(new ZodValidationPipe(CreateMediaVideoProfileDtoSchema)) dto: CreateMediaVideoProfileDto) {
    return this.service.createProfile(dto);
  }

  @Patch('admin/media/video/profiles/:profileId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '按配置版本更新视频 Profile；能力变更撤销验证和启用' })
  @ApiResponse({ status: 200, description: '更新后的 Profile 与服务端版本' })
  @ApiResponse({ status: 400, description: '参数无效或未校验即启用' })
  @ApiResponse({ status: 404, description: '视频 Profile 不存在' })
  @ApiResponse({ status: 409, description: '配置版本冲突' })
  @ApiResponse({ status: 503, description: '视频执行或校验组件未启用' })
  updateProfile(@Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(UpdateMediaVideoProfileDtoSchema)) dto: UpdateMediaVideoProfileDto) {
    return this.service.updateProfile(profileId, dto);
  }

  @Post('admin/media/video/profiles/:profileId/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '兼容旧版：只读校验视频配置与报价，不执行视频生成' })
  @ApiResponse({ status: 201, description: '配置校验结果，executionTested=false' })
  @ApiResponse({ status: 400, description: '模型未适配或参数超出适配范围' })
  @ApiResponse({ status: 404, description: '视频 Profile 不存在' })
  @ApiResponse({ status: 409, description: '配置版本冲突' })
  @ApiResponse({ status: 503, description: '视频执行或校验组件未启用' })
  verifyProfile(@Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(VerifyMediaVideoProfileDtoSchema)) dto: VerifyMediaVideoProfileDto) {
    return this.service.verifyProfile(profileId, dto);
  }

  @Post('admin/media/video/models/discover')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '检测视频模型并自动同步适配能力，不生成、不自动企业授权' })
  @ApiResponse({ status: 201, description: '模型检测结果；显式开发 mock 仅返回本地 fixture' })
  @ApiResponse({ status: 400, description: '仅接受空对象' })
  @ApiResponse({ status: 409, description: '连接或模型配置在同步期间发生变化' })
  @ApiResponse({ status: 503, description: '连接、目录或视频检查组件不可用' })
  discoverModels(@Body(new ZodValidationPipe(DiscoverMediaVideoModelsDtoSchema)) _dto: Record<string, never>) {
    return this.service.discoverModels();
  }

  @Get('enterprise/media-config/video')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '读取当前企业独立视频策略，默认禁用' })
  @ApiResponse({ status: 200, description: '视频策略、连接状态与编辑权限；配置不代表真实生成验收' })
  getEnterpriseConfig(@Request() req: { user: { id: string } }) {
    return this.service.getEnterpriseConfig(req.user.id);
  }

  @Put('enterprise/media-config/video')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '更新当前企业视频模型授权、操作及并发限制' })
  @ApiResponse({ status: 200, description: '保存后的独立视频策略；旧 periodBudget 仅兼容保存，不参与真实执行' })
  @ApiResponse({ status: 400, description: '策略或允许列表无效' })
  @ApiResponse({ status: 409, description: '并发策略更新冲突' })
  updateEnterpriseConfig(@Request() req: { user: { id: string } },
    @Body(new ZodValidationPipe(UpdateMediaVideoPolicyDtoSchema)) dto: UpdateMediaVideoPolicyDto) {
    return this.service.updateEnterpriseConfig(req.user.id, dto);
  }

  @Post('enterprise/media-config/video/preview')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '按当前服务端能力预览视频授权草稿，不保存或报价' })
  @ApiResponse({ status: 200, description: 'Profile 有效状态与过滤原因；不返回模型 ID 或连接信息' })
  @ApiResponse({ status: 400, description: '视频授权草稿或协议版本无效' })
  previewEnterpriseConfig(@Request() req: { user: { id: string } },
    @Body(new ZodValidationPipe(MediaVideoPolicyPreviewRequestSchema)) dto: MediaVideoPolicyPreviewRequest) {
    return this.service.previewEnterpriseConfig(req.user.id, dto);
  }

  @Get('enterprise/media-config/video/available-profiles')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '读取当前企业可选的已启用、已适配的视频模型' })
  @ApiResponse({ status: 200, description: '安全 Profile 列表，不含 modelId 或连接信息' })
  getAvailableProfiles(@Request() req: { user: { id: string } }) {
    return this.service.getAvailableProfiles(req.user.id);
  }
}

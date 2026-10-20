import { Body, Controller, Get, Param, Patch, Post, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateMediaVideoProfileDto, CreateMediaVideoProfileDtoSchema, DiscoverMediaVideoModelsDtoSchema,
  UpdateMediaVideoPolicyDto, UpdateMediaVideoPolicyDtoSchema, UpdateMediaVideoProfileDto,
  UpdateMediaVideoProfileDtoSchema, VerifyMediaVideoProfileDto, VerifyMediaVideoProfileDtoSchema,
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

  @Get('admin/media/video/profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '列出独立的视频 Profile；当前仅支持 mock' })
  @ApiResponse({ status: 200, description: '视频 Profile 列表，无连接凭据' })
  listProfiles() { return this.service.listProfiles(); }

  @Post('admin/media/video/profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '导入未启用的视频 Profile；真实模型尚未适配' })
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
  @ApiResponse({ status: 503, description: 'mock 未启用' })
  updateProfile(@Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(UpdateMediaVideoProfileDtoSchema)) dto: UpdateMediaVideoProfileDto) {
    return this.service.updateProfile(profileId, dto);
  }

  @Post('admin/media/video/profiles/:profileId/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '仅校验 mock fixture 配置，不调用真实模型或执行视频生成' })
  @ApiResponse({ status: 201, description: 'mock=true、executionTested=false 的配置校验结果' })
  @ApiResponse({ status: 400, description: '真实模型未适配或超出 fixture 规格' })
  @ApiResponse({ status: 404, description: '视频 Profile 不存在' })
  @ApiResponse({ status: 409, description: '配置版本冲突' })
  @ApiResponse({ status: 503, description: 'mock 未启用' })
  verifyProfile(@Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(VerifyMediaVideoProfileDtoSchema)) dto: VerifyMediaVideoProfileDto) {
    return this.service.verifyProfile(profileId, dto);
  }

  @Post('admin/media/video/models/discover')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: '仅发现显式启用的 mock 视频候选，不访问上游' })
  @ApiResponse({ status: 201, description: 'mock 候选列表；不代表真实验证' })
  @ApiResponse({ status: 400, description: '仅接受空对象' })
  discoverModels(@Body(new ZodValidationPipe(DiscoverMediaVideoModelsDtoSchema)) _dto: Record<string, never>) {
    return this.service.discoverModels();
  }

  @Get('enterprise/media-config/video')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '读取当前企业独立视频策略，默认禁用' })
  @ApiResponse({ status: 200, description: '视频策略、mock 配置状态、编辑权限；未验证真实执行' })
  getEnterpriseConfig(@Request() req: { user: { id: string } }) {
    return this.service.getEnterpriseConfig(req.user.id);
  }

  @Put('enterprise/media-config/video')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '更新当前企业视频策略；预算和并发仅配置，不代表真实执行约束已实现' })
  @ApiResponse({ status: 200, description: '保存后的 mock 视频策略；mock 零金额，不扣费' })
  @ApiResponse({ status: 400, description: '策略或允许列表无效' })
  @ApiResponse({ status: 409, description: '并发策略更新冲突' })
  updateEnterpriseConfig(@Request() req: { user: { id: string } },
    @Body(new ZodValidationPipe(UpdateMediaVideoPolicyDtoSchema)) dto: UpdateMediaVideoPolicyDto) {
    return this.service.updateEnterpriseConfig(req.user.id, dto);
  }

  @Get('enterprise/media-config/video/available-profiles')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '读取当前企业可选的已启用、已验证的 mock 视频 Profile' })
  @ApiResponse({ status: 200, description: '安全 Profile 列表，不含 modelId 或连接信息' })
  getAvailableProfiles(@Request() req: { user: { id: string } }) {
    return this.service.getAvailableProfiles(req.user.id);
  }
}

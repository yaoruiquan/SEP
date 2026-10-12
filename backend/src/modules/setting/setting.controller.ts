import { BadRequestException, Body, Controller, Get, Optional, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  TestMailDeliveryDtoSchema, UpdateSettingsDtoSchema, UpdateModelRuntimePolicyDtoSchema,
  RestoreModelRuntimePolicyDtoSchema, ModelRuntimePolicyHistoryQuerySchema,
  type TestMailDeliveryDto, type UpdateSettingsDto, type UpdateModelRuntimePolicyDto,
  type RestoreModelRuntimePolicyDto, type ModelRuntimePolicyHistoryQuery,
} from 'shared';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SettingService, type OAuthConfigProvider } from './setting.service';
import { MailService } from '../mail/mail.service';
import { ModelRuntimePolicyService } from './model-runtime-policy.service';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('settings')
export class SettingController {
  constructor(
    private readonly settingService: SettingService,
    private readonly modelRuntimePolicyService: ModelRuntimePolicyService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取系统设置（含分类、来源和生效状态；敏感项不回传明文）' })
  @ApiResponse({ status: 200, description: '配置项列表' })
  list() {
    return this.settingService.listForAdmin();
  }

  @Get('model-runtime-policy')
  @ApiOperation({ summary: '获取模型运行策略、字段元数据及环境部署预检（仅管理员）' })
  @ApiResponse({ status: 200, description: '当前版本、有效策略、字段来源、警告和服务端写入开关' })
  @ApiResponse({ status: 503, description: '策略读取依赖不可用' })
  modelRuntimePolicy() {
    return this.modelRuntimePolicyService.getForAdmin();
  }

  @Put('model-runtime-policy')
  @ApiOperation({ summary: '原子更新模型运行策略并记录审计（仅管理员）' })
  @ApiResponse({ status: 200, description: '新版本策略和完整变更差异；在途请求不切换策略' })
  @ApiResponse({ status: 400, description: '策略字段或跨字段校验失败' })
  @ApiResponse({ status: 409, description: '版本冲突，需保留草稿并重新加载' })
  @ApiResponse({ status: 503, description: '写入未开放或策略依赖不可用' })
  updateModelRuntimePolicy(
    @Body(new ZodValidationPipe(UpdateModelRuntimePolicyDtoSchema)) body: UpdateModelRuntimePolicyDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.modelRuntimePolicyService.update(body, req.user.id);
  }

  @Get('model-runtime-policy/history')
  @ApiOperation({ summary: '游标分页读取模型运行策略专用审计历史（仅管理员）' })
  @ApiResponse({ status: 200, description: '仅包含策略白名单的变更历史及下一页游标' })
  @ApiResponse({ status: 400, description: '分页参数无效' })
  @ApiResponse({ status: 404, description: '策略历史游标不存在' })
  @ApiResponse({ status: 503, description: '历史读取依赖不可用或审计损坏' })
  modelRuntimePolicyHistory(@Query(new ZodValidationPipe(ModelRuntimePolicyHistoryQuerySchema)) query: ModelRuntimePolicyHistoryQuery) {
    return this.modelRuntimePolicyService.history(query);
  }

  @Post('model-runtime-policy/restore')
  @ApiOperation({ summary: '恢复历史数据库覆盖并产生新的模型运行策略版本（仅管理员）' })
  @ApiResponse({ status: 201, description: '新版本策略及差异；未覆盖字段按当前环境生效' })
  @ApiResponse({ status: 400, description: '历史覆盖不符合当前策略边界' })
  @ApiResponse({ status: 404, description: '指定策略历史不存在' })
  @ApiResponse({ status: 409, description: '版本冲突' })
  @ApiResponse({ status: 503, description: '写入未开放或依赖不可用' })
  restoreModelRuntimePolicy(
    @Body(new ZodValidationPipe(RestoreModelRuntimePolicyDtoSchema)) body: RestoreModelRuntimePolicyDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    return this.modelRuntimePolicyService.restore(body, req.user.id);
  }

  @Post('mail/test')
  @ApiOperation({ summary: '测试 SMTP 连接（仅管理员）' })
  @ApiResponse({ status: 200, description: '连接测试结果' })
  async testMailConnection() {
    if (!this.mailService) throw new BadRequestException('邮件服务不可用');
    return this.mailService.testConnection();
  }

  @Post('mail/test-delivery')
  @ApiOperation({ summary: '发送测试邮件（仅管理员）' })
  @ApiResponse({ status: 200, description: '测试邮件已发送' })
  async sendTestMail(@Body(new ZodValidationPipe(TestMailDeliveryDtoSchema)) body: TestMailDeliveryDto) {
    if (!this.mailService) throw new BadRequestException('邮件服务不可用');
    await this.mailService.sendTestDelivery(body.to);
    return { success: true };
  }

  @Post('oauth/:provider/test')
  @ApiOperation({ summary: '检查微信、QQ 或钉钉 OAuth 配置完整性（仅管理员，不调用第三方）' })
  @ApiResponse({ status: 200, description: 'OAuth 配置检查结果' })
  async testOAuthConfig(@Param('provider') provider: string) {
    if (provider !== 'wechat' && provider !== 'qq' && provider !== 'dingtalk') throw new BadRequestException('不支持的 OAuth 登录方式');
    return this.settingService.checkOAuthConfig(provider as OAuthConfigProvider);
  }

  @Put()
  @ApiOperation({ summary: '更新系统设置（仅管理员，支持类型和范围校验）' })
  @ApiResponse({ status: 200, description: '更新成功并返回最新配置状态' })
  async update(@Body(new ZodValidationPipe(UpdateSettingsDtoSchema)) body: UpdateSettingsDto) {
    await this.settingService.updateMany(body);
    return this.settingService.listForAdmin();
  }
}

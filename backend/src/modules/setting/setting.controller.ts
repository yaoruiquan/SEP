import { BadRequestException, Body, Controller, Get, Optional, Param, Post, Put, UseGuards } from '@nestjs/common';
import { TestMailDeliveryDtoSchema, type TestMailDeliveryDto } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SettingService, type OAuthConfigProvider } from './setting.service';
import { MailService } from '../mail/mail.service';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('settings')
export class SettingController {
  constructor(
    private readonly settingService: SettingService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取系统设置（含分类、来源和生效状态；敏感项不回传明文）' })
  @ApiResponse({ status: 200, description: '配置项列表' })
  list() {
    return this.settingService.listForAdmin();
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
  async update(@Body() body: Record<string, string>) {
    await this.settingService.updateMany(body ?? {});
    return this.settingService.listForAdmin();
  }
}

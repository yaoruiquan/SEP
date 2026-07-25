import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SettingService } from './setting.service';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('settings')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Get()
  @ApiOperation({ summary: '获取系统设置（敏感项打码，仅管理员）' })
  @ApiResponse({ status: 200, description: '配置项列表' })
  list() {
    return this.settingService.listForAdmin();
  }

  @Put()
  @ApiOperation({ summary: '更新系统设置（仅管理员）' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async update(@Body() body: Record<string, string>) {
    await this.settingService.updateMany(body ?? {});
    return this.settingService.listForAdmin();
  }
}

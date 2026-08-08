import {
  Body,
  Controller,
  Get,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  UpdateEnterpriseSettingDto,
  UpdateEnterpriseSettingDtoSchema,
} from 'shared';
import { EnterpriseSettingsService } from './enterprise-settings.service';

type AuthedRequest = { user: { id: string } };

@ApiTags('Enterprise Settings')
@Controller('enterprise/settings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EnterpriseSettingsController {
  constructor(private readonly service: EnterpriseSettingsService) {}

  @Get()
  @ApiOperation({ summary: '获取企业安全与集成设置' })
  @ApiResponse({ status: 200 })
  async get(@Request() req: AuthedRequest) {
    return this.service.getSetting(req.user.id);
  }

  @Put()
  @ApiOperation({ summary: '更新企业安全与集成设置（仅企业管理员）' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: '非企业管理员' })
  async update(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(UpdateEnterpriseSettingDtoSchema))
    dto: UpdateEnterpriseSettingDto,
  ) {
    return this.service.updateSetting(req.user.id, dto);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
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
  UpdateEnterpriseModelConfigDto,
  UpdateEnterpriseModelConfigDtoSchema,
} from '../../shared/model-config.dto';
import { EnterpriseModelConfigService } from './enterprise-model-config.service';

type AuthedRequest = { user: { id: string } };

@ApiTags('Enterprise Model Config')
@Controller('enterprise/model-config')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EnterpriseModelConfigController {
  constructor(private readonly service: EnterpriseModelConfigService) {}

  @Get()
  @ApiOperation({ summary: '获取企业模型配置' })
  @ApiResponse({ status: 200 })
  async get(@Request() req: AuthedRequest) {
    return this.service.get(req.user.id);
  }

  @Put()
  @ApiOperation({ summary: '更新企业模型配置（仅企业管理员）' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: '非企业管理员' })
  async update(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(UpdateEnterpriseModelConfigDtoSchema))
    dto: UpdateEnterpriseModelConfigDto,
  ) {
    return this.service.update(req.user.id, dto);
  }

  @Get('available-models')
  @ApiOperation({ summary: '获取可用模型列表' })
  @ApiResponse({ status: 200 })
  async getAvailableModels(@Request() req: AuthedRequest) {
    return this.service.getAvailableModels(req.user.id);
  }

  @Get('effective')
  @ApiOperation({ summary: '解析生效的模型配置' })
  @ApiResponse({ status: 200 })
  async getEffective(
    @Request() req: AuthedRequest,
    @Query('departmentId') departmentId?: string,
    @Query('subscriptionId') subscriptionId?: string,
    @Query('userSelectedModel') userSelectedModel?: string,
  ) {
    return this.service.resolveEffectiveModel({
      userId: req.user.id,
      departmentId,
      subscriptionId,
      userSelectedModel,
    });
  }
}

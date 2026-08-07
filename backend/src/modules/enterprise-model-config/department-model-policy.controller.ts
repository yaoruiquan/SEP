import { Body, Controller, Get, Param, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  UpdateDepartmentModelPolicyDto,
  UpdateDepartmentModelPolicyDtoSchema,
} from '../../shared/model-config.dto';
import { EnterpriseModelConfigService } from './enterprise-model-config.service';

type AuthedRequest = { user: { id: string } };

/**
 * 部门级模型策略。
 *
 * 单独一个 controller 而不是挂在 EnterpriseModelConfigController 上：
 * 后者的前缀是 `enterprise/model-config`，而部门策略的自然路径是
 * `enterprise/departments/:id/model-policy`。
 */
@ApiTags('Enterprise Model Config')
@Controller('enterprise/departments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DepartmentModelPolicyController {
  constructor(private readonly service: EnterpriseModelConfigService) {}

  @Get(':id/model-policy')
  @ApiOperation({
    summary: '获取部门模型策略',
    description: '未设置策略时返回空策略（id=null），而非 404。',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: '部门不存在或不属于当前企业' })
  async get(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.service.getDepartmentPolicy(req.user.id, id);
  }

  @Put(':id/model-policy')
  @ApiOperation({
    summary: '设置部门模型策略（仅企业管理员）',
    description: 'defaultChatModel 传 null 表示该部门回退到企业默认模型。',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: '非企业管理员' })
  @ApiResponse({ status: 404, description: '部门不存在或不属于当前企业' })
  async update(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDepartmentModelPolicyDtoSchema))
    dto: UpdateDepartmentModelPolicyDto,
  ) {
    return this.service.setDepartmentPolicy(req.user.id, id, dto);
  }
}

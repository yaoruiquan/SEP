import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateCustomRoleDto,
  CreateCustomRoleDtoSchema,
  UpdateCustomRoleDto,
  UpdateCustomRoleDtoSchema,
  AssignCustomRoleDto,
  AssignCustomRoleDtoSchema,
} from 'shared';
import { EnterpriseSettingsService } from './enterprise-settings.service';

type AuthedRequest = { user: { id: string } };

@ApiTags('Enterprise Roles')
@Controller('enterprise/roles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CustomRoleController {
  constructor(private readonly service: EnterpriseSettingsService) {}

  @Get()
  @ApiOperation({ summary: '列出企业自定义角色（含内置角色）' })
  @ApiResponse({ status: 200 })
  list(@Request() req: AuthedRequest) {
    return this.service.listRoles(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: '创建自定义角色（仅企业管理员）' })
  @ApiResponse({ status: 201 })
  create(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateCustomRoleDtoSchema)) dto: CreateCustomRoleDto,
  ) {
    return this.service.createRole(req.user.id, dto);
  }

  @Put(':roleId')
  @ApiOperation({ summary: '更新自定义角色（仅企业管理员，内置角色不可改）' })
  @ApiParam({ name: 'roleId' })
  @ApiResponse({ status: 200 })
  update(
    @Request() req: AuthedRequest,
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(UpdateCustomRoleDtoSchema)) dto: UpdateCustomRoleDto,
  ) {
    return this.service.updateRole(req.user.id, roleId, dto);
  }

  @Delete(':roleId')
  @ApiOperation({ summary: '删除自定义角色（内置角色不可删）' })
  @ApiParam({ name: 'roleId' })
  @ApiResponse({ status: 204 })
  async delete(
    @Request() req: AuthedRequest,
    @Param('roleId') roleId: string,
  ) {
    await this.service.deleteRole(req.user.id, roleId);
  }

  @Patch('members/:memberId/assign')
  @ApiOperation({ summary: '为成员分配自定义角色（传 null 清除）' })
  @ApiParam({ name: 'memberId' })
  @ApiResponse({ status: 204 })
  async assignToMember(
    @Request() req: AuthedRequest,
    @Param('memberId') memberId: string,
    @Body(new ZodValidationPipe(AssignCustomRoleDtoSchema)) dto: AssignCustomRoleDto,
  ) {
    await this.service.assignRoleToMember(req.user.id, memberId, dto);
  }
}

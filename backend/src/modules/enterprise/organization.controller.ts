import { Controller, Get, Request, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OrganizationService } from "./organization.service";

@ApiTags("Enterprise Organization")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("enterprise")
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get("organization")
  @ApiOperation({
    summary: "企业组织、有效授权与硅基员工目录",
    description:
      "管理员可读全企业有效授权；普通成员及部门负责人仅可读本人或本人所在部门授权。部门授权不向子部门继承。leaderId 引用成员 ID；不支持个人直属上级关系。",
  })
  @ApiResponse({
    status: 200,
    description:
      "部门、成员基本信息、有效授权、企业员工目录及去重统计，不含邮箱、模型配置或提示词。",
  })
  @ApiResponse({ status: 401, description: "未登录或登录凭证失效" })
  @ApiResponse({ status: 403, description: "当前用户不属于任何企业" })
  getOrganization(@Request() request: { user: { id: string } }) {
    return this.organization.organization(request.user.id);
  }

  @Get("overview")
  @ApiOperation({
    summary: "企业硅基员工目录与统计",
    description:
      "目录包含所有订阅状态，总员工数按 employeeId 去重；可用数仅包括 ACTIVE 且未到期、当前用户具有有效直接或所属部门授权的员工。管理员也需要授权。运行状态复用 employee-status 接口。",
  })
  @ApiResponse({
    status: 200,
    description:
      "enterprise、permissions、statistics、employees；statistics 包含 employeeCount、subscriptionCount、activeEmployeeCount、currentUserAvailableEmployeeCount。",
  })
  @ApiResponse({ status: 401, description: "未登录或登录凭证失效" })
  @ApiResponse({ status: 403, description: "当前用户不属于任何企业" })
  getOverview(@Request() request: { user: { id: string } }) {
    return this.organization.overview(request.user.id);
  }
}

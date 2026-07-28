import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  DepartmentCreateDto,
  DepartmentCreateDtoSchema,
  DepartmentUpdateDto,
  DepartmentUpdateDtoSchema,
  MemberCreateDto,
  MemberCreateDtoSchema,
  MemberUpdateDto,
  MemberUpdateDtoSchema,
  InstanceCreateDto,
  InstanceCreateDtoSchema,
  InstanceUpdateDto,
  InstanceUpdateDtoSchema,
  InstanceStatusUpdateDto,
  InstanceStatusUpdateDtoSchema,
} from "shared";
import { DepartmentService } from "./department.service";
import { MemberService } from "./member.service";
import { InstanceService } from "./instance.service";

type AuthedRequest = { user: { id: string } };

@ApiTags("Enterprise Organization")
@Controller("enterprise")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EnterpriseController {
  constructor(
    private readonly departments: DepartmentService,
    private readonly members: MemberService,
    private readonly instances: InstanceService,
  ) {}

  // ── 部门 ──────────────────────────────────────────────────────────────────

  @Get("departments")
  @ApiOperation({ summary: "本企业部门树（含各部门成员数）" })
  @ApiResponse({ status: 200, description: "树形结构，children 嵌套" })
  @ApiResponse({ status: 403, description: "调用者不属于任何企业" })
  async departmentTree(@Request() req: AuthedRequest) {
    return this.departments.tree(req.user.id);
  }

  @Post("departments")
  @ApiOperation({ summary: "创建部门（仅企业管理员）" })
  @ApiResponse({ status: 201, description: "已创建" })
  @ApiResponse({ status: 403, description: "非企业管理员" })
  @ApiResponse({ status: 404, description: "父部门不存在或不属于本企业" })
  async createDepartment(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(DepartmentCreateDtoSchema))
    dto: DepartmentCreateDto,
  ) {
    return this.departments.create(req.user.id, dto);
  }

  @Patch("departments/:id")
  @ApiOperation({ summary: "重命名 / 移动部门（仅企业管理员）" })
  @ApiResponse({ status: 200, description: "已更新" })
  @ApiResponse({ status: 400, description: "移动会形成环" })
  @ApiResponse({ status: 404, description: "部门不存在或不属于本企业" })
  async updateDepartment(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DepartmentUpdateDtoSchema))
    dto: DepartmentUpdateDto,
  ) {
    return this.departments.update(req.user.id, id, dto);
  }

  @Delete("departments/:id")
  @ApiOperation({
    summary: "删除部门（仅企业管理员）",
    description: "有子部门或成员时拒绝，需先清空 —— 不做级联删除。",
  })
  @ApiResponse({ status: 200, description: "已删除" })
  @ApiResponse({ status: 409, description: "仍有子部门或成员" })
  async removeDepartment(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.departments.remove(req.user.id, id);
  }

  // ── 成员 ──────────────────────────────────────────────────────────────────

  @Get("members")
  @ApiOperation({ summary: "本企业成员列表" })
  @ApiResponse({ status: 200, description: "成员列表" })
  async listMembers(
    @Request() req: AuthedRequest,
    @Query("departmentId") departmentId?: string,
  ) {
    return this.members.list(req.user.id, departmentId);
  }

  @Post("members")
  @ApiOperation({
    summary: "添加成员（仅企业管理员）",
    description:
      "第二个人进入企业的唯一途径 —— 注册入口只用于开公司。" +
      "MVP 由管理员代建账号并设初始密码，暂不做邮件邀请。",
  })
  @ApiResponse({ status: 201, description: "已添加" })
  @ApiResponse({ status: 409, description: "邮箱已是本企业成员或已归属其他企业" })
  async createMember(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(MemberCreateDtoSchema)) dto: MemberCreateDto,
  ) {
    return this.members.create(req.user.id, dto);
  }

  @Patch("members/:id")
  @ApiOperation({ summary: "改角色 / 调岗（仅企业管理员）" })
  @ApiResponse({ status: 200, description: "已更新" })
  @ApiResponse({ status: 400, description: "不能降低自己的角色" })
  @ApiResponse({ status: 409, description: "企业需保留至少一名管理员" })
  async updateMember(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MemberUpdateDtoSchema)) dto: MemberUpdateDto,
  ) {
    return this.members.update(req.user.id, id, dto);
  }

  @Delete("members/:id")
  @ApiOperation({
    summary: "移出企业（仅企业管理员）",
    description: "只删除成员关系，保留 User 账号。",
  })
  @ApiResponse({ status: 200, description: "已移出" })
  @ApiResponse({ status: 400, description: "不能移除自己" })
  @ApiResponse({ status: 409, description: "企业需保留至少一名管理员" })
  async removeMember(@Request() req: AuthedRequest, @Param("id") id: string) {
    return this.members.remove(req.user.id, id);
  }

  // ── 员工实例 ──────────────────────────────────────────────────────────────

  @Get("instances")
  @ApiOperation({
    summary: "本企业员工实例列表",
    description:
      "upgradeAvailable 表示模板已发新版而此实例仍锁在旧版（提示式升级）。",
  })
  @ApiResponse({ status: 200, description: "实例列表" })
  async listInstances(@Request() req: AuthedRequest) {
    return this.instances.list(req.user.id);
  }

  @Post("instances")
  @ApiOperation({
    summary: "创建员工实例（仅企业管理员）",
    description:
      "需本企业对该模板有生效中的订阅。一次订阅可开多个实例 —— " +
      "同一模板可按部门各部署一份，互不影响。",
  })
  @ApiResponse({ status: 201, description: "已创建，初始状态 PENDING_ACTIVATION" })
  @ApiResponse({ status: 400, description: "未订阅该模板或订阅未生效" })
  @ApiResponse({ status: 404, description: "模板或部门不存在" })
  async createInstance(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(InstanceCreateDtoSchema))
    dto: InstanceCreateDto,
  ) {
    return this.instances.create(req.user.id, dto);
  }

  @Patch("instances/:id")
  @ApiOperation({ summary: "改名 / 换部门 / 改配置（仅企业管理员）" })
  @ApiResponse({ status: 200, description: "已更新" })
  @ApiResponse({ status: 404, description: "实例不存在或不属于本企业" })
  @ApiResponse({ status: 409, description: "已回收的实例不可修改" })
  async updateInstance(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(InstanceUpdateDtoSchema))
    dto: InstanceUpdateDto,
  ) {
    return this.instances.update(req.user.id, id, dto);
  }

  @Patch("instances/:id/status")
  @ApiOperation({
    summary: "启用 / 停用 / 回收实例（仅企业管理员）",
    description:
      "停用与回收不删除授权记录 —— 实例非 ACTIVE 时授权一律不生效，" +
      "恢复启用后原授权继续有效。REVOKED 为终态，不可转回。",
  })
  @ApiResponse({ status: 200, description: "已变更；changed=false 表示状态未变" })
  @ApiResponse({ status: 409, description: "非法状态流转" })
  async changeInstanceStatus(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(InstanceStatusUpdateDtoSchema))
    dto: InstanceStatusUpdateDto,
  ) {
    return this.instances.changeStatus(req.user.id, id, dto.status);
  }

  @Post("instances/:id/upgrade")
  @ApiOperation({
    summary: "升级实例到模板最新版（仅企业管理员）",
    description:
      "只更新版本号，不自动迁移 config；返回 configReviewRequired 提示复核配置。",
  })
  @ApiResponse({ status: 200, description: "已升级" })
  @ApiResponse({ status: 409, description: "已是最新版本或实例已回收" })
  async upgradeInstance(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.instances.upgrade(req.user.id, id);
  }
}

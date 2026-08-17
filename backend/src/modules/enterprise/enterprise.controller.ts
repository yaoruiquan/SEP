import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  AssignDeptMembersDto,
  AssignDeptMembersDtoSchema,
  DepartmentCreateDto,
  DepartmentCreateDtoSchema,
  DepartmentUpdateDto,
  DepartmentUpdateDtoSchema,
  MemberCreateDto,
  MemberCreateDtoSchema,
  MemberUpdateDto,
  MemberUpdateDtoSchema,
  InvitationCreateDto,
  InvitationCreateDtoSchema,
  InvitationStatusValue,
  SetDeptLeaderDto,
  SetDeptLeaderDtoSchema,
  GrantCreateDto,
  GrantCreateDtoSchema,
} from "shared";
import { EnterpriseService } from "./enterprise.service";
import { DepartmentService } from "./department.service";
import { MemberService } from "./member.service";
import { InvitationService } from "./invitation.service";
import { GrantService } from "./grant.service";
import { EnterpriseContextService } from "./enterprise-context.service";

type AuthedRequest = { user: { id: string } };

@ApiTags("Enterprise Organization")
@Controller("enterprise")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EnterpriseController {
  constructor(
    private readonly enterprise: EnterpriseService,
    private readonly departments: DepartmentService,
    private readonly members: MemberService,
    private readonly invitations: InvitationService,
    private readonly grants: GrantService,
    private readonly enterpriseCtx: EnterpriseContextService,
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

  // ── 部门成员管理 ───────────────────────────────────────────────────────────

  @Get("departments/:id/members")
  @ApiOperation({ summary: "列出部门成员（支持搜索/分页）" })
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "page", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiResponse({ status: 200, description: "成员列表 + 当前 leaderId" })
  async listDeptMembers(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.departments.listMembers(req.user.id, id, {
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post("departments/:id/members")
  @ApiOperation({ summary: "批量将成员分配到部门（管理员或部门主管）" })
  @ApiResponse({ status: 201, description: "已分配" })
  @ApiResponse({ status: 400, description: "部分 memberIds 无效" })
  @ApiResponse({ status: 403, description: "权限不足" })
  async assignDeptMembers(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AssignDeptMembersDtoSchema))
    dto: AssignDeptMembersDto,
  ) {
    return this.departments.assignMembers(req.user.id, id, dto);
  }

  @Delete("departments/:id/members/:memberId")
  @ApiOperation({ summary: "将成员从部门移除（管理员或部门主管）" })
  @ApiResponse({ status: 200, description: "已移除" })
  @ApiResponse({ status: 400, description: "成员不在此部门" })
  async removeDeptMember(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Param("memberId") memberId: string,
  ) {
    return this.departments.removeMember(req.user.id, id, memberId);
  }

  @Put("departments/:id/leader")
  @ApiOperation({ summary: "设置/清除部门主管（仅企业管理员）" })
  @ApiResponse({ status: 200, description: "已更新" })
  @ApiResponse({ status: 400, description: "新主管不在此部门中" })
  async setDeptLeader(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetDeptLeaderDtoSchema)) dto: SetDeptLeaderDto,
  ) {
    return this.departments.setLeader(req.user.id, id, dto);
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
      "管理员代建账号并设初始密码。想让对方自己设密码请改用邀请链接。" +
      "邮箱已注册时分三种处置：已是本企业成员 → 409；" +
      "已注册但无企业归属 → 直接加入，**沿用其原有密码**（响应带 " +
      "reusedExistingAccount=true，此时请勿把填写的密码转告对方）；" +
      "已归属其他企业 → 409，需其先退出原企业。",
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
    description: [
      "**回收**：本人名下的 EmployeeGrant 席位、待审批的越权申请（置为 CANCELED）、",
      "其所主管部门的 leader 归属。",
      "",
      "**保留**：已审批的申请及审批结论（申请人身份转为快照字段）、知识库、",
      "文档、会话与工作记录 —— 员工离职，企业侧沉淀不动。",
      "",
      "**User 账号保留**，该用户变为「无企业归属」，可凭原账号接受新邀请。",
      "",
      "响应中 `vacatedDepartments` 非空时，这些部门已无主管，需管理员重新指派。",
    ].join("\n"),
  })
  @ApiResponse({
    status: 200,
    description: "已移出，返回回收数量与待重新指派的部门",
  })
  @ApiResponse({ status: 400, description: "不能移除自己" })
  @ApiResponse({ status: 409, description: "企业需保留至少一名管理员" })
  async removeMember(@Request() req: AuthedRequest, @Param("id") id: string) {
    return this.members.remove(req.user.id, id);
  }

  // ── 企业邀请 ──────────────────────────────────────────────────────────────

  @Get("invitations")
  @ApiOperation({
    summary: "本企业邀请列表（仅企业管理员）",
    description: "顺带把已过期的 PENDING 收敛为 EXPIRED。不返回 token。",
  })
  @ApiResponse({ status: 200, description: "邀请列表" })
  async listInvitations(
    @Request() req: AuthedRequest,
    @Query("status") status?: InvitationStatusValue,
  ) {
    return this.invitations.list(req.user.id, status);
  }

  @Post("invitations")
  @ApiOperation({
    summary: "创建邀请（仅企业管理员）",
    description:
      "返回一次性明文 token，库里只存 SHA-256 摘要。" +
      "MVP 不发邮件，前端拼成 /join?token=xxx 由管理员自行转达。" +
      "重复邀请同一邮箱会先作废旧的 PENDING 链接。",
  })
  @ApiResponse({ status: 201, description: "已创建，响应含一次性 token" })
  @ApiResponse({ status: 409, description: "该邮箱已是本企业成员" })
  async createInvitation(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(InvitationCreateDtoSchema))
    dto: InvitationCreateDto,
  ) {
    return this.invitations.create(req.user.id, dto);
  }

  @Delete("invitations/:id")
  @ApiOperation({
    summary: "撤回邀请（仅企业管理员）",
    description: "撤回后链接立即失效。已接受的邀请不可撤回，应走移出企业。",
  })
  @ApiResponse({ status: 200, description: "已撤回" })
  @ApiResponse({ status: 409, description: "邀请已被接受或已失效" })
  async revokeInvitation(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.invitations.revoke(req.user.id, id);
  }

  // ── 员工授权 ──────────────────────────────────────────────────────────────

  @Get("my-employees")
  @ApiOperation({
    summary: "我可以使用的员工（使用者视角）",
    description:
      "合并直接授权给我 + 授权给我所在部门的雇佣关系，非 ACTIVE 或已过期的不返回。" +
      "同一雇佣关系两条路径都命中时只返回一条，直接授权优先。",
  })
  @ApiResponse({ status: 200, description: "可用员工列表" })
  async myEmployees(@Request() req: AuthedRequest) {
    return this.grants.myEmployees(req.user.id);
  }

  @Get("subscriptions/:id/grants")
  @ApiOperation({ summary: "某雇佣关系的授权列表（管理员视角）" })
  @ApiResponse({ status: 200, description: "授权列表，expired=true 的已标灰" })
  @ApiResponse({ status: 404, description: "雇佣关系不存在或不属于本企业" })
  async listGrants(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.grants.listForSubscription(req.user.id, id);
  }

  @Post("subscriptions/:id/grants")
  @ApiOperation({
    summary: "开通授权（仅企业管理员）",
    description: "授权对象二选一：departmentId 或 memberId，不能同时填或都不填。",
  })
  @ApiResponse({ status: 201, description: "已开通" })
  @ApiResponse({ status: 400, description: "雇佣关系已失效 / 授权对象不在本企业" })
  @ApiResponse({ status: 409, description: "该授权已存在" })
  async createGrant(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(GrantCreateDtoSchema)) dto: GrantCreateDto,
  ) {
    return this.grants.create(req.user.id, id, dto);
  }

  @Delete("grants/:id")
  @ApiOperation({
    summary: "收回授权（仅企业管理员）",
    description: "只删除该授权记录，不影响雇佣关系状态。",
  })
  @ApiResponse({ status: 200, description: "已收回" })
  @ApiResponse({ status: 404, description: "授权记录不存在或不属于本企业" })
  async removeGrant(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.grants.remove(req.user.id, id);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  @Get("info")
  @ApiOperation({ summary: "获取当前企业详细信息" })
  @ApiResponse({
    status: 200,
    description: "企业基本信息 + 统计数据",
  })
  async getEnterpriseInfo(@Request() req: AuthedRequest) {
    return this.enterprise.getEnterpriseInfo(req.user.id);
  }

  @Get("dashboard-stats")
  @ApiOperation({ summary: "获取 Dashboard 统计数据" })
  @ApiResponse({
    status: 200,
    description: "关键指标、消费趋势、热门员工、最近活动",
  })
  async getDashboardStats(@Request() req: AuthedRequest) {
    return this.enterprise.getDashboardStats(req.user.id);
  }

  // ── Onboarding ────────────────────────────────────────────────────────────

  @Post("onboarding/complete")
  @ApiOperation({ summary: "标记新手引导已完成" })
  @ApiResponse({
    status: 200,
    description: "已标记完成",
  })
  async markOnboardingCompleted(@Request() req: AuthedRequest) {
    return this.enterprise.markOnboardingCompleted(req.user.id);
  }

  // ── P3.3：运营端 ──────────────────────────────────────────────────────────

  @Get("admin/all-enterprises")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "P3.3：全部企业列表（仅平台运营）",
    description: "运营后台用，查看全平台所有企业的基础信息 + 成员数 + 订阅数。",
  })
  @ApiResponse({
    status: 200,
    description: "企业列表，按创建时间倒序",
  })
  async listAllEnterprises() {
    return this.enterpriseCtx.listAll();
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ComputeQuotaService } from './compute-quota.service';

@ApiTags('compute-quota')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compute-quota')
export class ComputeQuotaController {
  constructor(private readonly quotaService: ComputeQuotaService) {}

  // ── 总览 ────────────────────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({ summary: '查询三级配额总览' })
  @ApiResponse({ status: 200, description: '返回用户、订阅、企业三层配额汇总' })
  async getQuotaSummary(@Request() req) {
    return this.quotaService.getQuotaSummary(req.user.id);
  }

  @Get('packages')
  @ApiOperation({ summary: '查询企业算力包' })
  async getQuotaPackages() {
    return this.quotaService.getQuotaPackages();
  }

  @Post('packages/purchase')
  @ApiOperation({ summary: '使用企业钱包购买企业算力包' })
  async purchaseQuota(@Request() req, @Body() body: { packageId: string }) {
    return this.quotaService.purchaseEnterpriseQuota(req.user.id, body.packageId);
  }

  @Get('alerts')
  @ApiOperation({ summary: '查询配额告警（剩余 <10%）' })
  async getAlerts(@Request() req) {
    const ctx = await (this.quotaService as any).enterpriseContext.resolve(
      req.user.id,
    );
    return this.quotaService.checkQuotaAlerts(ctx.enterpriseId);
  }

  // ── 用户个人配额（碳基员工） ───────────────────────────────────────────────

  @Get('user-quotas')
  @ApiOperation({ summary: '查询企业所有成员的个人配额' })
  @ApiResponse({ status: 200, description: '返回所有碳基员工及其个人配额' })
  async listUserQuotas(@Request() req) {
    return this.quotaService.listUserQuotas(req.user.id);
  }

  @Post('user-quotas/allocate')
  @ApiOperation({ summary: '管理员为碳基员工分配个人配额' })
  @ApiResponse({ status: 201, description: '配额分配成功' })
  async allocateUserQuota(
    @Request() req,
    @Body()
    body: {
      targetUserId: string;
      totalTokens: number;
      notes?: string;
    },
  ) {
    return this.quotaService.allocateUserQuota(
      req.user.id,
      body.targetUserId,
      body.totalTokens,
      body.notes,
    );
  }

  // ── 订阅配额（硅基员工自带） ───────────────────────────────────────────────

  @Get('subscription-quotas')
  @ApiOperation({ summary: '查询企业所有订阅配额' })
  @ApiResponse({ status: 200, description: '返回所有硅基员工订阅自带配额' })
  async listSubscriptionQuotas(@Request() req) {
    return this.quotaService.listSubscriptionQuotas(req.user.id);
  }

  // ── 企业配额池（兜底） ────────────────────────────────────────────────────

  @Get('enterprise-quotas')
  @ApiOperation({ summary: '查询企业配额池列表' })
  @ApiResponse({ status: 200, description: '返回企业兜底配额池' })
  async listEnterpriseQuotas(@Request() req) {
    return this.quotaService.listEnterpriseQuotas(req.user.id);
  }

  @Post('enterprise-quotas/allocate')
  @ApiOperation({ summary: '管理员分配企业配额池' })
  @ApiResponse({ status: 201, description: '配额分配成功' })
  async allocateEnterpriseQuota(
    @Request() req,
    @Body()
    body: {
      type: string;
      totalTokens: number;
      priority?: number;
      expiresAt?: string;
    },
  ) {
    return this.quotaService.allocateEnterpriseQuota(req.user.id, {
      type: body.type,
      totalTokens: body.totalTokens,
      priority: body.priority,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '查询企业配额详情（含交易记录）' })
  async getQuotaDetail(@Request() req, @Param('id') id: string) {
    return this.quotaService.getQuotaDetail(req.user.id, id);
  }

  // ── 兼容旧接口 ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: '[已废弃] 查询企业配额列表，请使用 /enterprise-quotas' })
  async listQuotas(@Request() req) {
    return this.quotaService.listQuotas(req.user.id);
  }

  @Post('allocate')
  @ApiOperation({ summary: '[已废弃] 管理员分配配额，请使用 /enterprise-quotas/allocate' })
  async allocateQuota(
    @Request() req,
    @Body()
    body: {
      type: string;
      totalTokens: number;
      priority?: number;
      expiresAt?: string;
    },
  ) {
    return this.quotaService.allocateQuota(req.user.id, {
      type: body.type,
      totalTokens: body.totalTokens,
      priority: body.priority,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  }
}

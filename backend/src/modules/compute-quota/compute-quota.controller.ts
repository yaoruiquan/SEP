import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ComputeQuotaService } from './compute-quota.service';

/**
 * 旧 Token 配额体系的只读接口（迁移期对账用）。
 *
 * 真实余额与扣费请用 `/compute-credit/*`。这里返回的所有 token 数字都已停用，
 * 响应里带 `legacy` / `deprecated` 标记，前端必须显式提示而不是当余额展示。
 * 写入端点已全部移除：企业充值只进钱包，赠送额度只由订阅履约发放。
 */
@ApiTags('compute-quota (legacy)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compute-quota')
export class ComputeQuotaController {
  constructor(private readonly quotaService: ComputeQuotaService) {}

  @Get('legacy-summary')
  @ApiOperation({ summary: '[历史] 旧 Token 配额汇总，仅供对账，不是可用余额' })
  @ApiResponse({ status: 200, description: 'deprecated=true，token 数字均已停用' })
  async getLegacySummary(@Request() req) {
    return this.quotaService.getLegacyQuotaSummary(req.user.id);
  }

  @Get('subscription-quotas')
  @ApiOperation({ summary: '[历史] 旧订阅 Token 配额列表' })
  async listSubscriptionQuotas(@Request() req) {
    return this.quotaService.listSubscriptionQuotas(req.user.id);
  }

  @Get('user-quotas')
  @ApiOperation({ summary: '[历史] 旧成员个人 Token 配额列表' })
  async listUserQuotas(@Request() req) {
    return this.quotaService.listUserQuotas(req.user.id);
  }

  @Get('enterprise-quotas')
  @ApiOperation({ summary: '[历史] 旧企业 Token 池列表' })
  async listEnterpriseQuotas(@Request() req) {
    return this.quotaService.listEnterpriseQuotas(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '[历史] 旧企业配额详情（含旧交易记录）' })
  async getQuotaDetail(@Request() req, @Param('id') id: string) {
    return this.quotaService.getQuotaDetail(req.user.id, id);
  }
}

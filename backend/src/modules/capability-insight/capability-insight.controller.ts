import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityInsightService } from './capability-insight.service';
import {
  AdoptInsightDtoSchema,
  GenerateInsightDtoSchema,
} from './capability-insight.types';

type AuthRequest = { user: { id: string } };

/**
 * 智能沉淀建议（会议纪要2 §6.5 / 行动项 5）。
 *
 * 全部端点仅企业管理员 —— 建议正文里含成员的使用细节与个人改动。
 */
@ApiTags('Capability Insights')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enterprise')
export class CapabilityInsightController {
  constructor(private readonly service: CapabilityInsightService) {}

  @Post('capabilities/:capabilityId/insights/generate')
  @ApiOperation({
    summary: '生成迭代建议',
    description:
      'scope=MEMBER 分析单个成员（需 memberId）；scope=ALL 对全部使用者一键分析后统一提炼。同步返回，一次调用约 10–30 秒。',
  })
  @ApiParam({ name: 'capabilityId', description: '能力 ID' })
  @ApiResponse({ status: 201, description: '建议记录，含 findings 数组' })
  @ApiResponse({ status: 400, description: '没有使用记录也没有个人改动，无从分析' })
  @ApiResponse({ status: 403, description: '仅企业管理员' })
  @ApiResponse({ status: 502, description: '分析模型不可用' })
  generate(
    @Request() req: AuthRequest,
    @Param('capabilityId') capabilityId: string,
    @Body() body: unknown,
  ) {
    return this.service.generate(
      req.user.id,
      capabilityId,
      GenerateInsightDtoSchema.parse(body),
    );
  }

  @Get('capabilities/:capabilityId/insights')
  @ApiOperation({ summary: '迭代建议列表（最近 20 条）' })
  @ApiResponse({ status: 200, description: '建议列表，含处理状态' })
  list(@Request() req: AuthRequest, @Param('capabilityId') capabilityId: string) {
    return this.service.list(req.user.id, capabilityId);
  }

  @Post('insights/:id/adopt')
  @ApiOperation({
    summary: '采纳建议',
    description: '基于管理员确认后的正文生成新企业版本并切为生效。不走审核流 —— 采纳动作本身就是管理员做的。',
  })
  @ApiResponse({ status: 201, description: '新企业版本' })
  @ApiResponse({ status: 409, description: '该建议已处理过' })
  adopt(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.adopt(req.user.id, id, AdoptInsightDtoSchema.parse(body));
  }

  @Post('insights/:id/dismiss')
  @ApiOperation({ summary: '拒绝建议（留痕，不删除）' })
  dismiss(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.service.dismiss(req.user.id, id);
  }
}

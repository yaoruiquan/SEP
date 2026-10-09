import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Request, UseGuards, HttpCode, HttpStatus, Query, BadRequestException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';
import { SubscriptionEmployeeService } from './subscription-employee.service';
import { SubscriptionUsageService } from './subscription-usage.service';
import {
  SubscriptionCreateDto,
  SubscriptionUpdateDto,
  SubscriptionUpdateDtoSchema,
  SubscriptionStatusDto,
  SubscriptionStatusDtoSchema,
  SubscriptionUsageQueryDto,
  SubscriptionUsageQueryDtoSchema,
  SubscriptionUsageRecordParams,
  SubscriptionUsageRecordParamsSchema,
} from 'shared';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

@ApiTags('Subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionController {
  constructor(private subscriptionService: SubscriptionService, private readonly employeeService: SubscriptionEmployeeService, private readonly usageService: SubscriptionUsageService) {}

  @Get(':id/usage-records')
  @ApiOperation({ summary: '订阅使用记录：管理员查看企业，其他成员仅查看本人' })
  @ApiResponse({ status: 200, description: '统一排序分页的记录元数据、独立模型消费和覆盖限制' })
  @ApiResponse({ status: 400, description: '筛选或时间范围不正确' })
  @ApiResponse({ status: 403, description: '无有效使用授权或越权指定使用人' })
  @ApiResponse({ status: 404, description: '雇佣关系不存在' })
  usageRecords(@Param('id') id: string, @Request() req: { user: { id: string } },
    @Query(new ZodValidationPipe(SubscriptionUsageQueryDtoSchema)) query: SubscriptionUsageQueryDto) {
    return this.usageService.list(id, req.user.id, query);
  }

  @Get(':id/usage-records/:source/:recordId')
  @ApiOperation({ summary: '读取严格归属当前订阅的使用正文，不扩大个人聊天接口权限' })
  @ApiResponse({ status: 200, description: '当前订阅参与节点或严格归属 Web 会话的正文' })
  @ApiResponse({ status: 400, description: '记录来源或标识不正确' })
  @ApiResponse({ status: 403, description: '无有效使用授权' })
  @ApiResponse({ status: 404, description: '记录不存在或无法核实归属' })
  @ApiResponse({ status: 503, description: '管理员正文访问审计暂不可用' })
  usageRecordDetail(@Param('id') id: string, @Request() req: { user: { id: string } },
    @Param('source') source: string, @Param('recordId') recordId: string) {
    const params: SubscriptionUsageRecordParams = new ZodValidationPipe(SubscriptionUsageRecordParamsSchema)
      .transform({ source, recordId });
    return this.usageService.detail(id, req.user.id, params.source, params.recordId);
  }

  @Get(':id/employee-detail')
  @ApiOperation({ summary: '获取企业授权范围内的员工能力详情' })
  @ApiResponse({ status: 200, description: '员工公开资料和绑定能力，不含运行凭据' })
  @ApiResponse({ status: 403, description: '无有效使用授权' })
  @ApiResponse({ status: 404, description: '雇佣关系不存在' })
  employeeDetail(@Param('id') id: string, @Request() req: { user: { id: string } }) {
    return this.employeeService.detail(id, req.user.id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: '订阅使用统计：管理员查看企业，成员仅查看本人' })
  @ApiResponse({ status: 200, description: '指定时间范围的消费与可归属云端执行记录' })
  @ApiResponse({ status: 400, description: '时间范围不正确' })
  @ApiResponse({ status: 403, description: '无有效使用授权' })
  @ApiResponse({ status: 404, description: '雇佣关系不存在' })
  employeeStats(@Param('id') id: string, @Request() req: { user: { id: string } }, @Query('days') raw?: string) {
    const days = Number(raw ?? 7);
    if (![7, 30].includes(days)) throw new BadRequestException('days 仅支持 7 或 30');
    return this.employeeService.stats(id, req.user.id, days);
  }

  @Post()
  @ApiOperation({ summary: 'Subscribe to a digital employee' })
  @ApiResponse({ status: 201, description: 'Subscribed' })
  @ApiResponse({ status: 400, description: 'Employee not published' })
  @ApiResponse({ status: 409, description: 'Already subscribed' })
  async subscribe(
    @Body() dto: SubscriptionCreateDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.subscriptionService.subscribe(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List current user's active subscriptions" })
  @ApiResponse({ status: 200, description: 'Subscription list' })
  async findAll(@Request() req: { user: { id: string } }) {
    return this.subscriptionService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a subscription by id' })
  @ApiResponse({ status: 200, description: 'Subscription found' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.subscriptionService.findOne(id, req.user.id);
  }

  @Patch(':id/config')
  @ApiOperation({ summary: 'Update user-specific config (e.g. 店铺账号)' })
  @ApiResponse({ status: 200, description: 'Config updated' })
  async updateConfig(
    @Param('id') id: string,
    @Body('config') config: Record<string, any>,
    @Request() req: { user: { id: string } },
  ) {
    return this.subscriptionService.updateConfig(id, req.user.id, config);
  }

  @Patch(':id')
  @ApiOperation({ summary: '修改雇佣关系（自定义称呼 / 配置）' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 409, description: '已过期的雇佣关系不可修改' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SubscriptionUpdateDtoSchema))
    dto: SubscriptionUpdateDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.subscriptionService.update(id, req.user.id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '启用 / 暂停 / 终止雇佣关系' })
  @ApiResponse({ status: 200, description: 'Status changed' })
  @ApiResponse({ status: 409, description: '非法状态流转' })
  async changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SubscriptionStatusDtoSchema))
    dto: SubscriptionStatusDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.subscriptionService.changeStatus(id, req.user.id, dto.status);
  }

  @Post(':id/upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '升级到模板最新版本（提示式升级，不迁移 config）' })
  @ApiResponse({ status: 200, description: 'Upgraded' })
  @ApiResponse({ status: 409, description: '当前已是最新版本' })
  async upgrade(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.subscriptionService.upgrade(id, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '退订雇佣关系（设置为 EXPIRED；仅企业管理员）' })
  @ApiResponse({ status: 200, description: 'Unsubscribed' })
  @ApiResponse({ status: 403, description: '仅企业管理员可退订雇佣关系' })
  @ApiResponse({ status: 409, description: 'Subscription not active' })
  async unsubscribe(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.subscriptionService.unsubscribe(id, req.user.id);
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '解雇员工（TERMINATED）：7 天试用期内全额退款' })
  @ApiResponse({ status: 200, description: '已解聘，并返回试用期退款信息（退款进入企业钱包）' })
  @ApiResponse({ status: 409, description: 'Subscription not active' })
  async terminate(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @Request() req: { user: { id: string } },
  ) {
    return this.subscriptionService.terminate(id, req.user.id, reason);
  }
}

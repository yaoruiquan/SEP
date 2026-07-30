import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import { UserRole } from '@prisma/client';

const CreditAdjustmentSchema = z.object({
  amount: z.number().positive('金额必须大于0'),
  type: z.enum(['RECHARGE', 'DEDUCT'], {
    errorMap: () => ({ message: '类型必须是 RECHARGE 或 DEDUCT' })
  }),
  note: z.string().min(1, '备注不能为空').max(200, '备注不能超过200字符'),
});

const SuspendSchema = z.object({
  reason: z.string().min(1, '原因不能为空').max(500, '原因不能超过500字符'),
});

@ApiTags('admin')
@Controller('admin/enterprises')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: '获取企业列表（运营端）' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '页码，默认1' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '每页数量，默认20' })
  @ApiQuery({ name: 'keyword', required: false, type: String, description: '搜索关键词' })
  @ApiResponse({ status: 200, description: '返回企业列表' })
  listEnterprises(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.adminService.listEnterprises({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      keyword,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '获取企业详情（运营端）' })
  @ApiResponse({ status: 200, description: '返回企业详情，包含成员、实例、交易记录' })
  @ApiResponse({ status: 404, description: '企业不存在' })
  getEnterpriseDetail(@Param('id') id: string) {
    return this.adminService.getEnterpriseDetail(id);
  }

  @Post(':id/credit')
  @ApiOperation({ summary: '充值或扣减算力' })
  @ApiResponse({ status: 200, description: '操作成功，返回新余额' })
  @ApiResponse({ status: 400, description: '金额无效或余额不足' })
  @ApiResponse({ status: 404, description: '企业不存在' })
  creditAdjustment(
    @Param('id') enterpriseId: string,
    @Body(new ZodValidationPipe(CreditAdjustmentSchema)) dto: z.infer<typeof CreditAdjustmentSchema>,
    @Request() req: any,
  ) {
    return this.adminService.creditAdjustment({
      enterpriseId,
      amount: dto.amount,
      type: dto.type,
      note: dto.note,
      operatorId: req.user.id,
    });
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: '冻结企业' })
  @ApiResponse({ status: 200, description: '冻结成功' })
  @ApiResponse({ status: 400, description: '企业已被冻结' })
  @ApiResponse({ status: 404, description: '企业不存在' })
  suspendEnterprise(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SuspendSchema)) dto: z.infer<typeof SuspendSchema>,
    @Request() req: any,
  ) {
    return this.adminService.suspendEnterprise(id, dto.reason, req.user.id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: '解冻企业' })
  @ApiResponse({ status: 200, description: '解冻成功' })
  @ApiResponse({ status: 400, description: '企业未被冻结' })
  @ApiResponse({ status: 404, description: '企业不存在' })
  resumeEnterprise(@Param('id') id: string, @Request() req: any) {
    return this.adminService.resumeEnterprise(id, req.user.id);
  }
}

import { Controller, Get, Query, Request, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService, private readonly context: EnterpriseContextService) {}

  @Get()
  async list(@Request() req, @Query() query: any) {
    const ctx = req.user.role === 'ADMIN' ? null : await this.context.resolve(req.user.id);
    const role = req.user.role === 'ADMIN' ? 'ADMIN' : ctx?.role === 'ENTERPRISE_ADMIN' ? 'ENTERPRISE_ADMIN' : 'MEMBER';
    if (role === 'MEMBER') return { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 };
    return this.audit.list({ userId: req.user.id, role, enterpriseId: ctx?.enterpriseId }, { ...query, page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 50, from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined });
  }

  @Get('export')
  async export(@Request() req, @Query() query: any, @Res() res: Response) {
    const ctx = req.user.role === 'ADMIN' ? null : await this.context.resolve(req.user.id);
    const role = req.user.role === 'ADMIN' ? 'ADMIN' : ctx?.role === 'ENTERPRISE_ADMIN' ? 'ENTERPRISE_ADMIN' : 'MEMBER';
    if (role === 'MEMBER') return res.status(403).json({ message: '无权查看审计日志' });
    const csv = await this.audit.csv({ userId: req.user.id, role, enterpriseId: ctx?.enterpriseId }, { ...query, from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    return res.send(csv);
  }
}

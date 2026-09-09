import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const RETENTION_DAYS = 90;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actorId: string;
    enterpriseId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    result?: string;
    summary?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        enterpriseId: input.enterpriseId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        result: input.result ?? 'SUCCESS',
        summary: input.summary ?? null,
        metadata: input.metadata as any,
      },
    });
  }

  async list(actor: { userId: string; role: 'ADMIN' | 'ENTERPRISE_ADMIN' | 'MEMBER'; enterpriseId?: string | null }, query: { actorId?: string; action?: string; from?: Date; to?: Date; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const where: any = {
      createdAt: { gte: query.from && query.from > cutoff ? query.from : cutoff, ...(query.to ? { lte: query.to } : {}) },
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(actor.role === 'ENTERPRISE_ADMIN' ? { enterpriseId: actor.enterpriseId ?? '__missing__' } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { actor: { select: { id: true, name: true, email: true } }, enterprise: { select: { id: true, name: true } } } }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 };
  }

  async csv(actor: { userId: string; role: 'ADMIN' | 'ENTERPRISE_ADMIN' | 'MEMBER'; enterpriseId?: string | null }, query: Parameters<AuditService['list']>[1]) {
    const result = await this.list(actor, { ...query, page: 1, pageSize: 10000 });
    const esc = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = ['时间,操作人,企业,操作,资源类型,资源ID,结果,摘要'];
    for (const item of result.items) lines.push([item.createdAt.toISOString(), item.actor.name ?? item.actor.email, item.enterprise?.name, item.action, item.resourceType, item.resourceId, item.result, item.summary].map(esc).join(','));
    return `\ufeff${lines.join('\n')}`;
  }
}

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContext, EnterpriseContextService } from '../enterprise/enterprise-context.service';

@Injectable()
export class KnowledgeAccessPolicy {
  constructor(private readonly prisma: PrismaService, private readonly context: EnterpriseContextService) {}

  async resolve(userId: string): Promise<EnterpriseContext> {
    try {
      return await this.context.resolve(userId);
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      throw new ForbiddenException({ code: 'ENTERPRISE_MEMBERSHIP_REQUIRED', message: '需要有效企业成员身份' });
    }
  }

  isAdmin(viewer: EnterpriseContext) { return viewer.role === 'ENTERPRISE_ADMIN'; }

  readableWhere(viewer: EnterpriseContext): Prisma.KnowledgeBaseWhereInput {
    return { enterpriseId: viewer.enterpriseId,
      ...(!this.isAdmin(viewer) ? { memberGrants: { some: { memberId: viewer.memberId } } } : {}) };
  }

  permissions(viewer: EnterpriseContext) {
    const admin = this.isAdmin(viewer);
    return { canView: true, canSearch: true, canManage: admin, canUpload: admin, canManageGrants: admin };
  }

  requireAdmin(viewer: EnterpriseContext) {
    if (!this.isAdmin(viewer)) {
      throw new ForbiddenException({ code: 'KNOWLEDGE_ADMIN_REQUIRED', message: '仅企业管理员可执行此操作' });
    }
  }

  notFound(): never {
    throw new NotFoundException({ code: 'KNOWLEDGE_RESOURCE_NOT_FOUND', message: '知识库资源不存在或不可访问' });
  }

  async assertRead(userId: string, knowledgeBaseId: string) {
    const viewer = await this.resolve(userId);
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, ...this.readableWhere(viewer) }, select: { id: true },
    });
    if (!kb) this.notFound();
    return viewer;
  }

  async assertManage(userId: string, knowledgeBaseId: string) {
    const viewer = await this.assertRead(userId, knowledgeBaseId);
    this.requireAdmin(viewer);
    return viewer;
  }
}

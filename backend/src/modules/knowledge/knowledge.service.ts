import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import type {
  KnowledgeBaseCreateDto,
  KnowledgeBaseUpdateDto,
  DocumentUploadDto,
  KnowledgeGrantCreateDto,
} from 'shared';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseCtx: EnterpriseContextService,
  ) {}

  // ── 知识库 CRUD ────────────────────────────────────────────────────────────

  async list(userId: string) {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    return this.prisma.knowledgeBase.findMany({
      where: { enterpriseId },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        _count: { select: { documents: true, grants: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(userId: string, id: string) {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        documents: {
          include: {
            uploader: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        grants: {
          include: {
            subscription: {
              select: {
                id: true,
                name: true,
                employee: { select: { id: true, name: true } },
              },
            },
            department: { select: { id: true, name: true } },
          },
        },
        _count: { select: { documents: true, grants: true } },
      },
    });

    if (!kb) {
      throw new NotFoundException(`Knowledge base ${id} not found`);
    }

    if (kb.enterpriseId !== enterpriseId) {
      throw new ForbiddenException('Access denied');
    }

    return kb;
  }

  async create(userId: string, data: KnowledgeBaseCreateDto) {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    return this.prisma.knowledgeBase.create({
      data: {
        name: data.name,
        description: data.description,
        enterpriseId,
        createdBy: userId,
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        _count: { select: { documents: true, grants: true } },
      },
    });
  }

  async update(userId: string, id: string, data: KnowledgeBaseUpdateDto) {
    await this.getById(userId, id); // 验证权限

    return this.prisma.knowledgeBase.update({
      where: { id },
      data,
      include: {
        creator: { select: { id: true, name: true, email: true } },
        _count: { select: { documents: true, grants: true } },
      },
    });
  }

  async delete(userId: string, id: string) {
    await this.getById(userId, id); // 验证权限

    await this.prisma.knowledgeBase.delete({ where: { id } });
    return { success: true };
  }

  // ── 文档管理（MVP：只记录元数据，不做解析） ─────────────────────────────

  async listDocuments(userId: string, knowledgeBaseId: string) {
    await this.getById(userId, knowledgeBaseId); // 验证权限

    return this.prisma.document.findMany({
      where: { knowledgeBaseId },
      include: {
        uploader: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 创建文档记录（MVP：文件已上传到 /uploads，这里只记元数据）
   */
  async createDocument(
    userId: string,
    knowledgeBaseId: string,
    data: DocumentUploadDto & { filename: string; storagePath: string },
  ) {
    await this.getById(userId, knowledgeBaseId); // 验证权限

    return this.prisma.document.create({
      data: {
        filename: data.filename,
        originalName: data.originalName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        storagePath: data.storagePath,
        knowledgeBaseId,
        uploadedBy: userId,
        status: 'READY', // MVP: 直接标记为 READY，不做解析
      },
      include: {
        uploader: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async deleteDocument(userId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { knowledgeBase: true },
    });

    if (!doc) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);
    if (doc.knowledgeBase.enterpriseId !== enterpriseId) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.document.delete({ where: { id: documentId } });
    return { success: true };
  }

  // ── 授权管理 ──────────────────────────────────────────────────────────────

  async listGrants(userId: string, knowledgeBaseId: string) {
    await this.getById(userId, knowledgeBaseId); // 验证权限

    return this.prisma.knowledgeGrant.findMany({
      where: { knowledgeBaseId },
      include: {
        subscription: {
          select: {
            id: true,
            name: true,
            employee: { select: { id: true, name: true } },
          },
        },
        department: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 某段雇佣关系被授权了哪些知识库。
   *
   * 与 listGrants 反向 —— 那个按知识库看「授给了谁」，
   * 这个按雇佣关系看「能读哪些库」，雇佣关系的授权面板需要后者。
   */
  async listGrantsBySubscription(userId: string, subscriptionId: string) {
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    // 越权访问别家企业的雇佣关系直接挡掉，不能靠 where 过滤后返空数组糊过去
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { enterpriseId: true },
    });
    if (!subscription || subscription.enterpriseId !== enterpriseId) {
      throw new ForbiddenException('Invalid subscription');
    }

    return this.prisma.knowledgeGrant.findMany({
      where: { subscriptionId },
      include: {
        knowledgeBase: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createGrant(
    userId: string,
    knowledgeBaseId: string,
    data: KnowledgeGrantCreateDto,
  ) {
    await this.getById(userId, knowledgeBaseId); // 验证权限

    // 验证订阅或部门存在且属于本企业
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    if (data.subscriptionId) {
      const subscription = await this.prisma.subscription.findUnique({
        where: { id: data.subscriptionId },
      });
      if (!subscription || subscription.enterpriseId !== enterpriseId) {
        throw new ForbiddenException('Invalid subscription');
      }
    }

    if (data.departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: data.departmentId },
      });
      if (!dept || dept.enterpriseId !== enterpriseId) {
        throw new ForbiddenException('Invalid department');
      }
    }

    return this.prisma.knowledgeGrant.create({
      data: {
        knowledgeBaseId,
        subscriptionId: data.subscriptionId,
        departmentId: data.departmentId,
      },
      include: {
        subscription: {
          select: {
            id: true,
            name: true,
            employee: { select: { id: true, name: true } },
          },
        },
        department: { select: { id: true, name: true } },
      },
    });
  }

  async deleteGrant(userId: string, grantId: string) {
    const grant = await this.prisma.knowledgeGrant.findUnique({
      where: { id: grantId },
      include: { knowledgeBase: true },
    });

    if (!grant) {
      throw new NotFoundException(`Grant ${grantId} not found`);
    }

    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);
    if (grant.knowledgeBase.enterpriseId !== enterpriseId) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.knowledgeGrant.delete({ where: { id: grantId } });
    return { success: true };
  }
}

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EnterpriseContextService } from './enterprise-context.service';
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
            instance: {
              select: {
                id: true,
                name: true,
                template: { select: { id: true, name: true } },
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
        ...data,
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
        ...data,
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
        instance: {
          select: {
            id: true,
            name: true,
            template: { select: { id: true, name: true } },
          },
        },
        department: { select: { id: true, name: true } },
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

    // 验证实例或部门存在且属于本企业
    const { enterpriseId } = await this.enterpriseCtx.resolve(userId);

    if (data.instanceId) {
      const instance = await this.prisma.employeeInstance.findUnique({
        where: { id: data.instanceId },
      });
      if (!instance || instance.enterpriseId !== enterpriseId) {
        throw new ForbiddenException('Invalid instance');
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
        instanceId: data.instanceId,
        departmentId: data.departmentId,
      },
      include: {
        instance: {
          select: {
            id: true,
            name: true,
            template: { select: { id: true, name: true } },
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

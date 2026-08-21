import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { VectorService } from './vector.service';
import * as fs from 'fs/promises';
import type {
  KnowledgeBaseCreateDto,
  KnowledgeBaseUpdateDto,
  KnowledgeGrantCreateDto,
} from 'shared';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseCtx: EnterpriseContextService,
    private readonly vector: VectorService,
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
          select: {
            id: true,
            filename: true,
            originalName: true,
            fileSize: true,
            mimeType: true,
            status: true,
            createdAt: true,
            updatedAt: true,
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
    const context = await this.enterpriseCtx.resolve(userId);
    this.enterpriseCtx.assertEnterpriseAdmin(context);
    const { enterpriseId } = context;

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
    this.enterpriseCtx.assertEnterpriseAdmin(await this.enterpriseCtx.resolve(userId));
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
    this.enterpriseCtx.assertEnterpriseAdmin(await this.enterpriseCtx.resolve(userId));
    const knowledgeBase = await this.getById(userId, id); // 验证权限

    const documents = await this.prisma.document.findMany({
      where: { knowledgeBaseId: id },
      select: { storagePath: true },
    });
    await Promise.all(documents.map((document) => fs.unlink(document.storagePath).catch(() => undefined)));

    await this.prisma.knowledgeBase.delete({ where: { id } });
    this.vector.invalidateCache(knowledgeBase.enterpriseId, id);
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
    this.enterpriseCtx.assertEnterpriseAdmin(await this.enterpriseCtx.resolve(userId));
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
    this.enterpriseCtx.assertEnterpriseAdmin(await this.enterpriseCtx.resolve(userId));
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

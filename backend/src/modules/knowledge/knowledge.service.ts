import { BadRequestException, ForbiddenException, GoneException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VectorService } from './vector.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { EnterpriseContext } from '../enterprise/enterprise-context.service';
import { KNOWLEDGE_LIMITS, knowledgeMemberDisplay } from 'shared';
import type { KnowledgeBaseCreateDto, KnowledgeBaseUpdateDto, KnowledgePageQuery, KnowledgeMemberGrantCreateDto } from 'shared';

const memberSelect = {
  id: true, position: true, user: { select: { name: true, avatar: true } },
  department: { select: { name: true } },
} satisfies Prisma.EnterpriseMemberSelect;
const baseSelect = {
  id: true, name: true, description: true, revision: true, createdAt: true, updatedAt: true,
  _count: { select: { documents: { where: { deletedAt: null } } } },
} satisfies Prisma.KnowledgeBaseSelect;

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService, private readonly policy: KnowledgeAccessPolicy,
    private readonly vector: VectorService) {}

  private async present(kb: Prisma.KnowledgeBaseGetPayload<{ select: typeof baseSelect }>, viewer: EnterpriseContext) {
    const readyDocumentCount = await this.prisma.document.count({ where: { knowledgeBaseId: kb.id, deletedAt: null,
      knowledgeBase: { deletedAt: null }, OR: [
        { activeVersionId: null, status: 'READY' },
        { activeVersionId: { not: null }, versions: { some: { published: true, status: 'READY' } } },
      ] } });
    return { id: kb.id, name: kb.name, description: kb.description ?? '', revision: kb.revision,
      documentCount: kb._count.documents, readyDocumentCount, createdAt: kb.createdAt,
      updatedAt: kb.updatedAt, permissions: this.policy.permissions(viewer) };
  }

  async list(userId: string, query: KnowledgePageQuery = { page: 1, pageSize: 20 }) {
    const viewer = await this.policy.resolve(userId);
    const where: Prisma.KnowledgeBaseWhereInput = { ...this.policy.readableWhere(viewer),
      ...(query.keyword ? { OR: [{ name: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } }] } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.knowledgeBase.findMany({ where, select: baseSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.knowledgeBase.count({ where }),
    ]);
    const admin = this.policy.isAdmin(viewer);
    return { items: await Promise.all(rows.map(row => this.present(row, viewer))), page: query.page,
      pageSize: query.pageSize, total,
      viewer: { memberId: viewer.memberId, enterpriseId: viewer.enterpriseId, role: admin ? 'ADMIN' : 'EMPLOYEE' },
      capabilities: { canCreateKnowledgeBase: admin, canListGrantCandidates: admin }, limits: KNOWLEDGE_LIMITS };
  }

  async getById(userId: string, id: string) {
    const viewer = await this.policy.assertRead(userId, id);
    const kb = await this.prisma.knowledgeBase.findFirst({ where: { id, ...this.policy.readableWhere(viewer) }, select: baseSelect });
    if (!kb) this.policy.notFound();
    return this.present(kb, viewer);
  }

  async create(userId: string, data: KnowledgeBaseCreateDto) {
    const viewer = await this.policy.resolve(userId);
    this.policy.requireAdmin(viewer);
    const row = await this.prisma.knowledgeBase.create({
      data: { name: data.name, description: data.description ?? '', enterpriseId: viewer.enterpriseId, createdBy: userId },
      select: baseSelect,
    });
    return this.present(row, viewer);
  }

  async update(userId: string, id: string, data: KnowledgeBaseUpdateDto) {
    const viewer = await this.policy.assertManage(userId, id);
    const row = await this.prisma.knowledgeBase.update({ where: { id },
      data: { ...data, revision: { increment: 1 } }, select: baseSelect });
    return this.present(row, viewer);
  }

  async delete(userId: string, id: string) {
    const viewer = await this.policy.assertManage(userId, id);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM knowledge_bases WHERE id = ${id} FOR UPDATE`;
      const member = await tx.enterpriseMember.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
      if (!member) throw new ForbiddenException({ code: 'ENTERPRISE_MEMBERSHIP_REQUIRED', message: '需要有效企业成员身份' });
      this.policy.requireAdmin({ ...member, memberId: member.id });
      const base = await tx.knowledgeBase.findFirst({ where: { id, enterpriseId: member.enterpriseId, deletedAt: null } });
      if (!base) this.policy.notFound();
      // Workers lock documents before publishing. Keep the same order when fencing their jobs.
      await tx.$queryRaw`SELECT id FROM documents WHERE "knowledgeBaseId" = ${id} ORDER BY id FOR UPDATE`;
      const documents = await tx.document.findMany({ where: { knowledgeBaseId: id }, select: { id: true } });
      const deletedAt = new Date();
      await tx.knowledgeBase.update({ where: { id }, data: { deletedAt, revision: { increment: 1 } } });
      await tx.document.updateMany({ where: { knowledgeBaseId: id },
        data: { deletedAt, activeVersionId: null, revision: { increment: 1 } } });
      await tx.documentVersion.updateMany({ where: { document: { knowledgeBaseId: id } }, data: { published: false } });
      await tx.knowledgeProcessingJob.updateMany({ where: { document: { knowledgeBaseId: id }, status: { in: ['PENDING', 'RUNNING'] } },
        data: { status: 'CANCELLED', fence: { increment: 1 }, leaseUntil: null } });
      if (documents.length) await tx.knowledgeProcessingJob.createMany({
        data: documents.map(document => ({ documentId: document.id, kind: 'CLEANUP' })),
      });
    });
    this.vector.invalidateCache(viewer.enterpriseId, id);
  }

  async listGrants(userId: string, knowledgeBaseId: string, query: KnowledgePageQuery = { page: 1, pageSize: 20 }) {
    await this.policy.assertManage(userId, knowledgeBaseId);
    const where: Prisma.KnowledgeMemberGrantWhereInput = { knowledgeBaseId, knowledgeBase: { deletedAt: null },
      ...(query.keyword ? { member: { OR: [{ user: { name: { contains: query.keyword, mode: 'insensitive' } } },
        { position: { contains: query.keyword, mode: 'insensitive' } }] } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.knowledgeMemberGrant.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: { id: true, createdAt: true, grantedByMemberId: true, grantedByName: true, member: { select: memberSelect } } }),
      this.prisma.knowledgeMemberGrant.count({ where }),
    ]);
    return { items: rows.map(row => ({ id: row.id, member: knowledgeMemberDisplay(row.member), grantedAt: row.createdAt,
      grantedBy: { memberId: row.grantedByMemberId, name: row.grantedByName } })), page: query.page, pageSize: query.pageSize, total };
  }

  async createGrant(userId: string, knowledgeBaseId: string, data: KnowledgeMemberGrantCreateDto) {
    await this.policy.assertManage(userId, knowledgeBaseId);
    return this.prisma.$transaction(async tx => {
      // Revalidate admin identity inside the transaction before writing the entire batch.
      const viewer = await tx.enterpriseMember.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
      if (!viewer) throw new ForbiddenException({ code: 'ENTERPRISE_MEMBERSHIP_REQUIRED', message: '需要有效企业成员身份' });
      await tx.$queryRaw`SELECT id FROM enterprise_members WHERE id = ${viewer.id} FOR SHARE`;
      const current = await tx.enterpriseMember.findUnique({ where: { id: viewer.id } });
      if (!current) throw new ForbiddenException({ code: 'ENTERPRISE_MEMBERSHIP_REQUIRED', message: '需要有效企业成员身份' });
      this.policy.requireAdmin({ ...current, memberId: current.id });
      const kb = await tx.knowledgeBase.findFirst({ where: { id: knowledgeBaseId, enterpriseId: current.enterpriseId, deletedAt: null } });
      if (!kb) this.policy.notFound();
      await tx.$queryRaw`SELECT id FROM enterprise_members WHERE id IN (${Prisma.join([...data.memberIds].sort())}) ORDER BY id FOR SHARE`;
      const members = await tx.enterpriseMember.findMany({ where: { id: { in: data.memberIds }, enterpriseId: current.enterpriseId }, select: { id: true } });
      if (members.length !== data.memberIds.length) {
        throw new BadRequestException({ code: 'MEMBER_SELECTION_INVALID', message: '请选择有效的本企业成员' });
      }
      const owner = await tx.enterpriseMember.findUnique({ where: { id: current.id }, select: { user: { select: { name: true } } } });
      const addedMemberIds: string[] = [];
      const existingMemberIds: string[] = [];
      for (const memberId of [...data.memberIds].sort()) {
        const result = await tx.knowledgeMemberGrant.createMany({ data: [{ knowledgeBaseId, memberId,
          grantedByMemberId: current.id, grantedByName: owner?.user.name?.trim() || '企业管理员' }], skipDuplicates: true });
        (result.count ? addedMemberIds : existingMemberIds).push(memberId);
      }
      if (addedMemberIds.length) await tx.knowledgeBase.update({ where: { id: knowledgeBaseId }, data: { revision: { increment: 1 } } });
      return { addedMemberIds, existingMemberIds };
    });
  }

  async revokeMemberGrant(userId: string, knowledgeBaseId: string, memberId: string) {
    await this.policy.assertManage(userId, knowledgeBaseId);
    await this.prisma.$transaction(async tx => {
      const viewer = await tx.enterpriseMember.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
      if (!viewer) throw new ForbiddenException({ code: 'ENTERPRISE_MEMBERSHIP_REQUIRED', message: '需要有效企业成员身份' });
      await tx.$queryRaw`SELECT id FROM enterprise_members WHERE id = ${viewer.id} FOR SHARE`;
      const current = await tx.enterpriseMember.findUnique({ where: { id: viewer.id } });
      if (!current) throw new ForbiddenException({ code: 'ENTERPRISE_MEMBERSHIP_REQUIRED', message: '需要有效企业成员身份' });
      this.policy.requireAdmin({ ...current, memberId: current.id });
      const kb = await tx.knowledgeBase.findFirst({ where: { id: knowledgeBaseId, enterpriseId: current.enterpriseId, deletedAt: null } });
      const member = await tx.enterpriseMember.findFirst({ where: { id: memberId, enterpriseId: current.enterpriseId }, select: { id: true } });
      if (!kb || !member) this.policy.notFound();
      const deleted = await tx.knowledgeMemberGrant.deleteMany({ where: { knowledgeBaseId, memberId } });
      if (deleted.count) await tx.knowledgeBase.update({ where: { id: knowledgeBaseId }, data: { revision: { increment: 1 } } });
    });
  }

  async listGrantsBySubscription(userId: string, _subscriptionId: string) {
    await this.policy.resolve(userId);
    throw new GoneException({ code: 'LEGACY_KNOWLEDGE_GRANTS_RETIRED', message: '订阅知识库绑定已停用，请使用成员授权' });
  }

  async deleteGrant(userId: string, _grantId: string) {
    const viewer = await this.policy.resolve(userId);
    this.policy.requireAdmin(viewer);
    throw new GoneException({ code: 'LEGACY_KNOWLEDGE_GRANTS_RETIRED', message: '旧知识库授权已停用，历史记录保留' });
  }

  async retireLegacyGrant(userId: string, knowledgeBaseId: string) {
    await this.policy.assertRead(userId, knowledgeBaseId);
    throw new GoneException({ code: 'LEGACY_KNOWLEDGE_GRANTS_RETIRED', message: '订阅和部门知识库绑定已停用，请使用成员授权' });
  }
}

import { Injectable, BadRequestException, GoneException, ConflictException, HttpException } from '@nestjs/common';
import { Document, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeQueueService } from './knowledge-queue.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import type { KnowledgePageQuery } from 'shared';
import { VectorService } from './vector.service';
import { KnowledgePrivateStorage } from './knowledge-private-storage';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';

const publicVersionSelect = {
  id: true, version: true, originalName: true, mimeType: true, fileSize: true, status: true, stage: true,
  errorCode: true, lastError: true, retryable: true, attempts: true, processedChunks: true, totalChunks: true,
  createdAt: true, processedAt: true,
} satisfies Prisma.DocumentVersionSelect;
const publicDocumentSelect = {
  id: true, knowledgeBaseId: true, filename: true, originalName: true, mimeType: true, fileSize: true, status: true,
  version: true, revision: true, activeVersionId: true, latestVersionId: true, createdAt: true, updatedAt: true,
  processedAt: true, versions: { select: publicVersionSelect }, uploader: { select: { name: true } },
} satisfies Prisma.DocumentSelect;
type VersionedDocument = Prisma.DocumentGetPayload<{ select: typeof publicDocumentSelect }>;
type PublicVersion = Prisma.DocumentVersionGetPayload<{ select: typeof publicVersionSelect }>;
type WriteHeaders = { ifMatch?: string; idempotencyKey?: string };
const safeVersion = (v?: PublicVersion) => v ? ({
  id: v.id, version: v.version, originalName: v.originalName, mimeType: v.mimeType, fileSize: v.fileSize,
  status: v.status, stage: v.stage, errorCode: v.errorCode, lastError: v.lastError, retryable: v.retryable,
  attempts: v.attempts, processedChunks: v.processedChunks, totalChunks: v.totalChunks,
  createdAt: v.createdAt, processedAt: v.processedAt,
}) : null;

@Injectable()
export class DocumentService {
  private readonly storage = new KnowledgePrivateStorage();
  constructor(private prisma: PrismaService, private queue: KnowledgeQueueService,
    private policy: KnowledgeAccessPolicy, private vector: VectorService) {}

  expectedRevision(value?: string) {
    if (!value) throw new HttpException({ code: 'PRECONDITION_REQUIRED', message: '请刷新文档后重试' }, 428);
    if (!/^"kbdoc-[a-f0-9]{64}"$/.test(value)) {
      throw new BadRequestException({ code: 'INVALID_IF_MATCH', message: 'If-Match 必须为当前文档 revision 的强 ETag' });
    }
    return value;
  }

  present(d: VersionedDocument) {
    const active = d.versions?.find(v => v.id === d.activeVersionId);
    const latest = d.versions?.find(v => v.id === d.latestVersionId);
    const result = { id: d.id, knowledgeBaseId: d.knowledgeBaseId, filename: d.filename,
      originalName: d.originalName, mimeType: latest?.mimeType ?? d.mimeType, fileSize: latest?.fileSize ?? d.fileSize,
      status: latest?.status ?? d.status, version: latest?.version ?? d.version, revision: d.revision,
      activeVersionId: d.activeVersionId, latestVersionId: d.latestVersionId,
      searchable: !!active || (!d.activeVersionId && d.status === 'READY'),
      activeVersion: safeVersion(active), latestVersion: safeVersion(latest), createdAt: d.createdAt,
      updatedAt: d.updatedAt, processedAt: d.processedAt, uploader: d.uploader ? { name: d.uploader.name } : undefined };
    return { ...result, etag: `"kbdoc-${createHash('sha256').update(JSON.stringify(result)).digest('hex')}"` };
  }

  async uploadDocument(kbId: string, file: Express.Multer.File, userId: string, headers: WriteHeaders = {}) {
    await this.assertAdminAccess(kbId, userId);
    const original = await this.storage.prepare(file);
    const requestHash = this.hash(['UPLOAD', original.sha256, original.originalName, original.mimeType]);
    const key = this.key(headers.idempotencyKey);
    const storagePath = await this.storage.write(original.data);
    let retained = false;
    try {
      const result = await this.prisma.$transaction(async tx => {
        await this.lockBase(tx, kbId, userId);
        return this.idempotent(tx, kbId, userId, key, requestHash, async () => {
          const d = await tx.document.create({ data: { knowledgeBaseId: kbId, uploadedBy: userId,
            filename: original.originalName, originalName: original.originalName, fileSize: original.fileSize,
            mimeType: original.mimeType, storagePath, status: 'PENDING' } });
          const v = await tx.documentVersion.create({ data: { documentId: d.id, version: 1,
            originalName: original.originalName, mimeType: original.mimeType, fileSize: original.fileSize,
            storagePath, sha256: original.sha256 } });
          await tx.document.update({ where: { id: d.id }, data: { latestVersionId: v.id } });
          await tx.knowledgeProcessingJob.create({ data: { documentId: d.id, versionId: v.id } });
          return { documentId: d.id, storagePath };
        });
      });
      retained = result.storagePath === storagePath;
      return await this.getDocumentForUser(kbId, result.documentId, userId);
    } finally { if (!retained) await this.storage.remove(storagePath); }
  }

  async uploadVersion(kbId: string, id: string, file: Express.Multer.File, userId: string, headers: WriteHeaders) {
    await this.assertDocumentAdminAccess(kbId, id, userId);
    const revision = this.expectedRevision(headers.ifMatch);
    const key = this.key(headers.idempotencyKey);
    const original = await this.storage.prepare(file);
    const requestHash = this.hash(['REPLACE', id, revision, original.sha256, original.originalName, original.mimeType]);
    const storagePath = await this.storage.write(original.data);
    let retained = false;
    try {
      const result = await this.prisma.$transaction(async tx => {
        await this.lockBase(tx, kbId, userId);
        return this.idempotent(tx, kbId, userId, key, requestHash, async () => {
          const d = await this.adoptLegacy(tx, await this.lockDocument(tx, kbId, id, revision));
          const latest = await tx.documentVersion.findUnique({ where: { id: d.latestVersionId! } });
          if (latest && ['PENDING', 'PROCESSING'].includes(latest.status)) this.busy();
          const active = d.activeVersionId ? await tx.documentVersion.findUnique({ where: { id: d.activeVersionId } }) : null;
          if (active?.sha256 === original.sha256) return { documentId: id, unchanged: true, storagePath: active.storagePath };
          const v = await tx.documentVersion.create({ data: { documentId: id, version: (latest?.version ?? d.version) + 1,
            originalName: original.originalName, fileSize: original.fileSize, mimeType: original.mimeType,
            sha256: original.sha256, storagePath } });
          await tx.document.update({ where: { id }, data: { latestVersionId: v.id, revision: { increment: 1 } } });
          await tx.knowledgeProcessingJob.create({ data: { documentId: id, versionId: v.id } });
          return { documentId: id, unchanged: false, storagePath };
        });
      });
      retained = result.storagePath === storagePath;
      return { ...await this.getDocumentForUser(kbId, id, userId), unchanged: !!result.unchanged };
    } finally { if (!retained) await this.storage.remove(storagePath); }
  }

  async retry(kbId: string, id: string, userId: string, headers: WriteHeaders) {
    await this.assertDocumentAdminAccess(kbId, id, userId);
    const revision = this.expectedRevision(headers.ifMatch);
    const key = this.key(headers.idempotencyKey);
    await this.prisma.$transaction(async tx => {
      await this.lockBase(tx, kbId, userId);
      return this.idempotent(tx, kbId, userId, key, this.hash(['RETRY', id, revision]), async () => {
        const d = await this.adoptLegacy(tx, await this.lockDocument(tx, kbId, id, revision));
        const v = await tx.documentVersion.findUniqueOrThrow({ where: { id: d.latestVersionId! } });
        if (v.status !== 'FAILED' || !v.retryable || v.id === d.activeVersionId) {
          throw new ConflictException({ code: 'DOCUMENT_NOT_RETRYABLE', message: '当前版本不可重试，请上传新版本' });
        }
        const generation = v.generation + 1;
        await tx.documentVersion.update({ where: { id: v.id }, data: { generation, status: 'PENDING',
          stage: 'QUEUED', errorCode: null, lastError: null, attempts: 0, processedChunks: 0, totalChunks: null } });
        await tx.knowledgeProcessingJob.create({ data: { documentId: id, versionId: v.id, generation } });
        await tx.document.update({ where: { id }, data: { revision: { increment: 1 } } });
        return { documentId: id };
      });
    });
    return this.getDocumentForUser(kbId, id, userId);
  }

  async listDocumentsForUser(kbId: string, userId: string) {
    await this.policy.assertRead(userId, kbId);
    const rows = await this.prisma.document.findMany({ where: { knowledgeBaseId: kbId, deletedAt: null },
      orderBy: { createdAt: 'desc' }, select: publicDocumentSelect });
    return rows.map(row => this.present(row));
  }
  async getDocumentForUser(kbId: string, id: string, userId: string) {
    await this.policy.assertRead(userId, kbId);
    const d = await this.prisma.document.findUnique({ where: { id, knowledgeBaseId: kbId, deletedAt: null },
      select: publicDocumentSelect });
    if (!d) this.policy.notFound();
    return this.present(d);
  }
  async listVersions(kbId: string, id: string, userId: string) {
    await this.getDocumentForUser(kbId, id, userId);
    return (await this.prisma.documentVersion.findMany({ where: { documentId: id }, orderBy: { version: 'desc' }, select: publicVersionSelect })).map(safeVersion);
  }

  async preview(kbId: string, id: string, userId: string,
    query: Pick<KnowledgePageQuery, 'page' | 'pageSize'> & { versionId?: string }) {
    await this.policy.assertRead(userId, kbId);
    const d = await this.prisma.document.findFirst({ where: { id, knowledgeBaseId: kbId, deletedAt: null },
      select: { id: true, originalName: true, status: true, activeVersionId: true } });
    if (!d) this.policy.notFound();
    if (query.versionId && query.versionId !== d.activeVersionId) this.versionChanged();
    if (!d.activeVersionId && d.status !== 'READY') throw new ConflictException({ code: 'DOCUMENT_NOT_READY', message: '文档尚未处理完成' });
    if (d.activeVersionId) {
      const where = { versionId: d.activeVersionId, version: { documentId: id, status: 'READY' as const, published: true } };
      const [blocks, total] = await Promise.all([
        this.prisma.knowledgeParsedBlock.findMany({ where, orderBy: { ordinal: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        this.prisma.knowledgeParsedBlock.count({ where }),
      ]);
      await this.checkPreviewCurrent(kbId, id, userId, d.activeVersionId);
      return { documentId: id, documentName: d.originalName, versionId: d.activeVersionId, previewKind: 'PARSED_BLOCKS',
        items: blocks.map(b => ({ chunkId: b.id, text: b.text, page: b.page })), page: query.page, pageSize: query.pageSize, total };
    }
    const where = { knowledgeBaseId: kbId, documentId: id, versionId: null, document: { status: 'READY' as const, deletedAt: null } };
    const [chunks, total] = await Promise.all([
      this.prisma.textChunk.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize,
        take: query.pageSize, select: { id: true, content: true } }), this.prisma.textChunk.count({ where }),
    ]);
    await this.checkPreviewCurrent(kbId, id, userId, null);
    return { documentId: id, documentName: d.originalName, versionId: null, previewKind: 'PROCESSED_CHUNKS',
      items: chunks.map(c => ({ chunkId: c.id, text: c.content })), page: query.page, pageSize: query.pageSize, total };
  }
  private versionChanged(): never { throw new ConflictException({ code: 'DOCUMENT_VERSION_CHANGED', message: '生效版本已更新，请重新打开预览' }); }
  private async checkPreviewCurrent(kbId: string, id: string, userId: string, versionId: string | null) {
    await this.policy.assertRead(userId, kbId);
    const current = await this.prisma.document.findFirst({ where: { id, knowledgeBaseId: kbId, deletedAt: null },
      select: { activeVersionId: true, status: true,
        versions: { where: { id: versionId ?? undefined, status: 'READY', published: true }, select: { id: true } } } });
    if (!current) this.policy.notFound();
    if ((current.activeVersionId ?? null) !== versionId) this.versionChanged();
    if (versionId ? !current.versions.some(v => v.id === versionId) : current.status !== 'READY') {
      throw new ConflictException({ code: 'DOCUMENT_NOT_READY', message: '文档尚未处理完成' });
    }
  }

  async deleteDocument(kbId: string, id: string, userId: string, headers: WriteHeaders = {}) {
    await this.assertAdminAccess(kbId, userId);
    const revision = this.expectedRevision(headers.ifMatch);
    const viewer = await this.policy.resolve(userId);
    await this.prisma.$transaction(async tx => {
      await this.lockBase(tx, kbId, userId);
      return this.idempotent(tx, kbId, userId, this.key(headers.idempotencyKey), this.hash(['DELETE', id, revision]), async () => {
        await this.lockDocument(tx, kbId, id, revision);
        await tx.document.update({ where: { id }, data: { deletedAt: new Date(), activeVersionId: null, revision: { increment: 1 } } });
        await tx.documentVersion.updateMany({ where: { documentId: id }, data: { published: false } });
        await tx.knowledgeProcessingJob.updateMany({ where: { documentId: id, status: { in: ['PENDING', 'RUNNING'] } },
          data: { status: 'CANCELLED', fence: { increment: 1 }, leaseUntil: null } });
        await tx.knowledgeProcessingJob.create({ data: { documentId: id, kind: 'CLEANUP' } });
        return { documentId: id };
      });
    });
    this.vector.invalidateCache(viewer.enterpriseId, kbId);
  }
  async downloadDocument(kbId: string, _id: string, userId: string): Promise<{ path: string; filename: string }> {
    await this.policy.assertRead(userId, kbId);
    throw new GoneException({ code: 'KNOWLEDGE_OPERATION_RETIRED', message: '原始文件下载已停用，请使用只读预览' });
  }
  async assertAdminAccess(kbId: string, userId: string) { await this.policy.assertManage(userId, kbId); }
  async assertDocumentAdminAccess(kbId: string, id: string, userId: string) {
    await this.assertAdminAccess(kbId, userId);
    if (!await this.prisma.document.findFirst({ where: { id, knowledgeBaseId: kbId, deletedAt: null }, select: { id: true } })) this.policy.notFound();
  }
  private key(key?: string) {
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '需要有效的 Idempotency-Key' });
    return key;
  }
  private hash(value: unknown[]) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private busy(): never { throw new ConflictException({ code: 'DOCUMENT_PROCESSING', message: '当前已有版本在处理中' }); }
  private async lockBase(tx: Prisma.TransactionClient, id: string, userId: string) {
    const viewer = await tx.enterpriseMember.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
    if (!viewer) this.policy.notFound();
    // Match offboarding's member-before-base lock order and fence role changes through commit.
    await tx.$queryRaw`SELECT id FROM enterprise_members WHERE id=${viewer.id} FOR SHARE`;
    const member = await tx.enterpriseMember.findUnique({ where: { id: viewer.id } });
    if (!member || member.role !== 'ENTERPRISE_ADMIN') this.policy.notFound();
    await tx.$queryRaw`SELECT id FROM knowledge_bases WHERE id=${id} FOR UPDATE`;
    const base = await tx.knowledgeBase.findFirst({ where: { id, deletedAt: null, enterpriseId: member.enterpriseId } });
    if (!base || base.enterpriseId !== member.enterpriseId) this.policy.notFound();
  }
  private async lockDocument(tx: Prisma.TransactionClient, kbId: string, id: string, revision: string) {
    await tx.$queryRaw`SELECT id FROM documents WHERE id=${id} FOR UPDATE`;
    const d = await tx.document.findFirst({ where: { id, knowledgeBaseId: kbId, deletedAt: null } });
    if (!d) this.policy.notFound();
    const representation = await tx.document.findUniqueOrThrow({ where: { id }, select: publicDocumentSelect });
    if (this.present(representation).etag !== revision) throw new HttpException({ code: 'REVISION_CONFLICT', message: '文档已更新，请刷新后重试' }, 412);
    return d;
  }
  private async idempotent(tx: Prisma.TransactionClient, kbId: string, userId: string, key: string, requestHash: string,
    run: () => Promise<{ documentId: string; storagePath?: string; unchanged?: boolean }>) {
    const existing = await tx.knowledgeIdempotency.findUnique({ where: { userId_knowledgeBaseId_key: { userId, knowledgeBaseId: kbId, key } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '同一幂等键不能用于不同请求' });
      return existing.result as { documentId: string; storagePath?: string; unchanged?: boolean };
    }
    const result = await run();
    await tx.knowledgeIdempotency.create({ data: { userId, knowledgeBaseId: kbId, key, requestHash, result } });
    return result;
  }
  /** Adopt originals on their first write without reprocessing or deleting old READY chunks. */
  private async adoptLegacy(tx: Prisma.TransactionClient, d: Document) {
    if (d.latestVersionId) return d;
    if (d.status === 'PROCESSING' || d.status === 'PENDING') this.busy();
    const data = await fs.readFile(d.storagePath);
    const v = await tx.documentVersion.create({ data: { documentId: d.id, version: d.version,
      originalName: d.originalName, mimeType: d.mimeType, fileSize: d.fileSize, storagePath: d.storagePath,
      sha256: createHash('sha256').update(data).digest('hex'), status: d.status,
      stage: d.status === 'READY' ? 'DONE' : 'FAILED', published: d.status === 'READY',
      ...(d.status === 'READY' ? { profile: { kind: 'legacy-adopted', compatibility: 'model-only' } } : {}) } });
    if (d.status === 'READY') {
      await tx.textChunk.updateMany({ where: { documentId: d.id, versionId: null }, data: { versionId: v.id, indexGeneration: 1 } });
      const chunks = await tx.textChunk.findMany({ where: { versionId: v.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      await tx.knowledgeParsedBlock.createMany({ data: chunks.map((c, ordinal) => ({ versionId: v.id, ordinal, text: c.content })) });
    }
    return tx.document.update({ where: { id: d.id }, data: { latestVersionId: v.id, ...(d.status === 'READY' ? { activeVersionId: v.id } : {}) } });
  }
}

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeQueueService } from './knowledge-queue.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { VectorService } from './vector.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class DocumentService {
  constructor(
    private prisma: PrismaService,
    private queue: KnowledgeQueueService,
    private enterpriseContext: EnterpriseContextService,
    private vector: VectorService,
  ) {}

  // 文件上传保存目录
  private readonly uploadDir = path.join(
    process.env.UPLOAD_PATH ?? path.join(__dirname, '..', '..', '..', 'uploads'),
    'knowledge',
  );

  /**
   * 确保上传目录存在
   */
  private async ensureUploadDir() {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
    }
  }

  /**
   * 上传文档
   */
  async uploadDocument(
    knowledgeBaseId: string,
    file: Express.Multer.File,
    userId: string,
  ) {
    await this.assertAdminAccess(knowledgeBaseId, userId);

    // 验证文件类型（Phase C1：新增图片 OCR 支持）
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'text/markdown',
      'image/png',
      'image/jpeg',
      'image/jpg',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Unsupported file type. Supported: PDF, Word, TXT, Markdown, PNG, JPEG',
      );
    }

    // 验证文件大小（最大 10MB）
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 10MB limit');
    }

    await this.ensureUploadDir();

    // 生成唯一文件名
    const ext = path.extname(file.originalname);
    const filename = `${randomUUID()}${ext}`;
    const storagePath = path.join(this.uploadDir, filename);

    // 保存文件到磁盘（从 multer 临时文件复制）
    if (file.buffer) {
      // memoryStorage 模式
      await fs.writeFile(storagePath, file.buffer);
    } else if (file.path) {
      // diskStorage 模式 - 读取临时文件并复制
      const data = await fs.readFile(file.path);
      await fs.writeFile(storagePath, data);
      // 删除临时文件
      await fs.unlink(file.path).catch(() => {});
    } else {
      throw new BadRequestException('File data not available');
    }

    let document: Awaited<ReturnType<typeof this.prisma.document.create>> | undefined;
    try {
      // 创建文档记录并入队异步处理（BullMQ，不等待完成）。任一步失败都回滚，
      // 避免生产环境留下磁盘孤儿文件或永远处于 PENDING 的孤儿文档。
      document = await this.prisma.document.create({
        data: {
          knowledgeBaseId,
          filename,
          originalName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          storagePath,
          uploadedBy: userId,
          status: 'PENDING', // 初始状态为待处理
        },
      });
      await this.queue.enqueue(document.id);
    } catch (error) {
      if (document) {
        await this.prisma.document.delete({ where: { id: document.id } }).catch(() => {});
      }
      await fs.unlink(storagePath).catch(() => {});
      throw error;
    }

    // `storagePath` is an internal infrastructure detail. Keep it available
    // to backend processing, but never expose an absolute server path to clients.
    const { storagePath: _storagePath, ...publicDocument } = document;
    return publicDocument;
  }

  /**
   * 获取知识库的文档列表
   */
  async listDocumentsForUser(knowledgeBaseId: string, userId: string) {
    await this.assertReadAccess(knowledgeBaseId, userId);
    const documents = await this.prisma.document.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        uploader: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return documents;
  }

  /**
   * 获取单个文档详情
   */
  async getDocumentForUser(knowledgeBaseId: string, id: string, userId: string) {
    await this.assertReadAccess(knowledgeBaseId, userId);
    const document = await this.prisma.document.findUnique({
      where: { id, knowledgeBaseId },
      select: {
        id: true,
        knowledgeBaseId: true,
        filename: true,
        originalName: true,
        fileSize: true,
        mimeType: true,
        status: true,
        uploadedBy: true,
        createdAt: true,
        updatedAt: true,
        version: true,
        lastError: true,
        processedAt: true,
        embeddingModel: true,
        uploader: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  /**
   * 删除文档
   */
  async deleteDocument(knowledgeBaseId: string, id: string, userId: string) {
    await this.assertAdminAccess(knowledgeBaseId, userId);
    const document = await this.prisma.document.findUnique({
      where: { id, knowledgeBaseId },
      include: { knowledgeBase: { select: { enterpriseId: true } } },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // 删除文件
    try {
      await fs.unlink(document.storagePath);
    } catch (error) {
      console.error('Failed to delete file:', error);
      // 继续删除数据库记录，即使文件删除失败
    }

    // 删除数据库记录（会级联删除关联的 TextChunk）
    await this.prisma.document.delete({
      where: { id },
    });
    this.vector.invalidateCache(document.knowledgeBase.enterpriseId, knowledgeBaseId);
  }

  /**
   * 下载文档
   */
  async downloadDocument(
    knowledgeBaseId: string,
    id: string,
    userId: string,
  ): Promise<{ path: string; filename: string }> {
    await this.assertReadAccess(knowledgeBaseId, userId);
    const document = await this.prisma.document.findUnique({
      where: { id, knowledgeBaseId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // 验证文件存在
    try {
      await fs.access(document.storagePath);
    } catch {
      throw new NotFoundException('File not found on disk');
    }

    return {
      path: document.storagePath,
      filename: document.originalName,
    };
  }

  async assertAdminAccess(knowledgeBaseId: string, userId: string): Promise<void> {
    const context = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(context);
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, enterpriseId: context.enterpriseId },
      select: { id: true },
    });
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found');
  }

  async assertDocumentAdminAccess(
    knowledgeBaseId: string,
    documentId: string,
    userId: string,
  ): Promise<void> {
    await this.assertAdminAccess(knowledgeBaseId, userId);
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, knowledgeBaseId },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Document not found');
  }

  private async assertReadAccess(knowledgeBaseId: string, userId: string): Promise<void> {
    const context = await this.enterpriseContext.resolve(userId);
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, enterpriseId: context.enterpriseId },
      select: { id: true },
    });
    if (!knowledgeBase) throw new NotFoundException('Knowledge base not found');
  }
}

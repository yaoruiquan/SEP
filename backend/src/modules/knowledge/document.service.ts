import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentProcessorService } from './document-processor.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class DocumentService {
  constructor(
    private prisma: PrismaService,
    private processor: DocumentProcessorService,
  ) {}

  // 文件上传保存目录
  private readonly uploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'knowledge');

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
    // 验证知识库是否存在
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
    });

    if (!kb) {
      throw new NotFoundException('Knowledge base not found');
    }

    // 验证文件类型
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'text/markdown',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Unsupported file type. Supported: PDF, Word, TXT, Markdown',
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

    // 创建文档记录
    const document = await this.prisma.document.create({
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

    // 触发异步处理（不等待完成）
    this.processor.processDocument(document.id).catch((error) => {
      console.error(`Failed to process document ${document.id}:`, error);
    });

    return document;
  }

  /**
   * 获取知识库的文档列表
   */
  async listDocuments(knowledgeBaseId: string) {
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
  async getDocument(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: {
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
  async deleteDocument(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
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
  }

  /**
   * 下载文档
   */
  async downloadDocument(id: string): Promise<{ path: string; filename: string }> {
    const document = await this.prisma.document.findUnique({
      where: { id },
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
}

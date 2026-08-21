import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  Res,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentService } from './document.service';
import { DocumentProcessorService } from './document-processor.service';
import { Response } from 'express';
import { createReadStream } from 'fs';

@ApiTags('Knowledge - Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge-bases/:knowledgeBaseId/documents')
export class DocumentController {
  constructor(
    private documentService: DocumentService,
    private processor: DocumentProcessorService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: '上传文档到知识库' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    const userId = req.user.id; // JWT strategy sets req.user.id
    if (!file) throw new BadRequestException('No file uploaded');
    return this.documentService.uploadDocument(knowledgeBaseId, file, userId);
  }

  @Get()
  @ApiOperation({ summary: '获取知识库的文档列表' })
  async listDocuments(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Request() req,
  ) {
    return this.documentService.listDocumentsForUser(knowledgeBaseId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文档详情' })
  async getDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.documentService.getDocumentForUser(knowledgeBaseId, id, req.user.id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: '下载文档' })
  async downloadDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { path, filename } = await this.documentService.downloadDocument(
      knowledgeBaseId,
      id,
      req.user.id,
    );

    const file = createReadStream(path);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });

    return new StreamableFile(file);
  }

  @Post(':id/reprocess')
  @ApiOperation({ summary: '重新处理文档（重新解析和向量化）' })
  async reprocessDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    await this.documentService.assertDocumentAdminAccess(
      knowledgeBaseId,
      id,
      req.user.id,
    );
    await this.processor.reprocessDocument(id);
    return { message: 'Document reprocessing started' };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文档' })
  async deleteDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    await this.documentService.deleteDocument(knowledgeBaseId, id, req.user.id);
    return { message: 'Document deleted successfully' };
  }
}

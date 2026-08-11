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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocumentService } from './document.service';
import { DocumentProcessorService } from './document-processor.service';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

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
      storage: diskStorage({
        destination: './uploads/knowledge',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    }),
  )
  async uploadDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    const userId = req.user.id; // JWT strategy sets req.user.id
    return this.documentService.uploadDocument(knowledgeBaseId, file, userId);
  }

  @Get()
  @ApiOperation({ summary: '获取知识库的文档列表' })
  async listDocuments(@Param('knowledgeBaseId') knowledgeBaseId: string) {
    return this.documentService.listDocuments(knowledgeBaseId);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文档详情' })
  async getDocument(@Param('id') id: string) {
    return this.documentService.getDocument(id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: '下载文档' })
  async downloadDocument(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { path, filename } = await this.documentService.downloadDocument(id);

    const file = createReadStream(path);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });

    return new StreamableFile(file);
  }

  @Post(':id/reprocess')
  @ApiOperation({ summary: '重新处理文档（重新解析和向量化）' })
  async reprocessDocument(@Param('id') id: string) {
    await this.processor.reprocessDocument(id);
    return { message: 'Document reprocessing started' };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文档' })
  async deleteDocument(@Param('id') id: string) {
    await this.documentService.deleteDocument(id);
    return { message: 'Document deleted successfully' };
  }
}

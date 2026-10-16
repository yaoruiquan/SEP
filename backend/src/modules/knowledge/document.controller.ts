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
  BadRequestException,
  Query,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { KnowledgePreviewQuerySchema, KnowledgeEmptyBodySchema, type KnowledgePageQuery } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Body } from '@nestjs/common';
import { KnowledgeNoStoreInterceptor } from './knowledge-no-store.interceptor';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { DocumentService } from './document.service';
import { DocumentProcessorService } from './document-processor.service';

@ApiTags('Knowledge - Documents')
@ApiBearerAuth()
@UseGuards(KnowledgeAuthGuard)
@UseInterceptors(KnowledgeNoStoreInterceptor)
@ApiResponse({ status: 404, description: '资源不存在或不可访问' })
@Controller('knowledge-bases/:knowledgeBaseId/documents')
export class DocumentController {
  constructor(
    private documentService: DocumentService,
    private processor: DocumentProcessorService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: '上传文档到知识库' })
  @ApiResponse({ status: 201, description: '第一批兼容上传：安全旧文档字段，未版本化' })
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
    @Body(new ZodValidationPipe(KnowledgeEmptyBodySchema)) _body: Record<string, never>,
    @Request() req,
  ) {
    const userId = req.user.id; // JWT strategy sets req.user.id
    if (!file) throw new BadRequestException('No file uploaded');
    return this.documentService.uploadDocument(knowledgeBaseId, file, userId);
  }

  @Get()
  @ApiOperation({ summary: '获取知识库的文档列表' })
  @ApiResponse({ status: 200, description: '第一批兼容文档数组，未版本化' })
  async listDocuments(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Request() req,
  ) {
    return this.documentService.listDocumentsForUser(knowledgeBaseId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文档详情' })
  @ApiResponse({ status: 200, description: '安全文档详情，未版本化' })
  async getDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.documentService.getDocumentForUser(knowledgeBaseId, id, req.user.id);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: '已处理片段的分页只读预览（非版本化解析块）' })
  @ApiResponse({ status: 200, description: 'documentId/documentName/previewKind=PROCESSED_CHUNKS/items[{chunkId,text}]/page/pageSize/total' })
  @ApiResponse({ status: 409, description: 'DOCUMENT_NOT_READY' })
  async preview(@Param('knowledgeBaseId') kbId: string, @Param('id') id: string, @Request() req,
    @Query(new ZodValidationPipe(KnowledgePreviewQuerySchema)) query: Pick<KnowledgePageQuery, 'page' | 'pageSize'>) {
    return this.documentService.preview(kbId, id, req.user.id, query);
  }

  @Get(':id/download')
  @ApiOperation({ summary: '下载文档' })
  @ApiResponse({ status: 410, description: '原件下载已停用' })
  async downloadDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.documentService.downloadDocument(knowledgeBaseId, id, req.user.id);
  }

  @Post(':id/reprocess')
  @ApiOperation({ summary: '重新处理文档（重新解析和向量化）' })
  @ApiResponse({ status: 201, description: '兼容重处理结果，不承诺不可变版本或幂等' })
  async reprocessDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
    @Body(new ZodValidationPipe(KnowledgeEmptyBodySchema)) _body: Record<string, never>,
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
  @HttpCode(204)
  @ApiOperation({ summary: '删除文档' })
  @ApiResponse({ status: 204, description: '删除成功' })
  async deleteDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    await this.documentService.deleteDocument(knowledgeBaseId, id, req.user.id);
  }
}

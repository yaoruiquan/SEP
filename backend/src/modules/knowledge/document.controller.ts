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
  Headers,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { KnowledgePreviewQuerySchema, KnowledgeEmptyBodySchema, type KnowledgePageQuery } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Body } from '@nestjs/common';
import { KnowledgeNoStoreInterceptor } from './knowledge-no-store.interceptor';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { DocumentService } from './document.service';
import { KnowledgeUploadGuard } from './knowledge-upload.guard';

@ApiTags('Knowledge - Documents')
@ApiBearerAuth()
@UseGuards(KnowledgeAuthGuard)
@UseInterceptors(KnowledgeNoStoreInterceptor)
@ApiResponse({ status: 404, description: '资源不存在或不可访问' })
@Controller('knowledge-bases/:knowledgeBaseId/documents')
export class DocumentController {
  constructor(
    private documentService: DocumentService,
  ) {}

  @Post('upload')
  @UseGuards(KnowledgeUploadGuard)
  @HttpCode(202)
  @ApiOperation({ summary: '上传文档到知识库' })
  @ApiResponse({ status: 202, description: '原件和持久化版本作业已接收，不代表可检索' })
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
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: import('express').Response,
  ) {
    const userId = req.user.id; // JWT strategy sets req.user.id
    if (!file) throw new BadRequestException('No file uploaded');
    const result = await this.documentService.uploadDocument(knowledgeBaseId, file, userId, { idempotencyKey });
    response.setHeader('ETag', result.etag);
    return result;
  }

  @Post(':id/versions')
  @UseGuards(KnowledgeUploadGuard)
  @HttpCode(202)
  @ApiOperation({ summary: '上传指定文档的新版本，处理成功后原子生效' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 202, description: '新版已接收，旧版继续生效' })
  @ApiResponse({ status: 200, description: '内容与生效版相同，unchanged=true' })
  @ApiResponse({ status: 412, description: 'revision 冲突' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadVersion(@Param('knowledgeBaseId') kbId: string, @Param('id') id: string,
    @Request() req, @UploadedFile() file: Express.Multer.File,
    @Headers('if-match') ifMatch: string, @Headers('idempotency-key') idempotencyKey: string,
    @Body(new ZodValidationPipe(KnowledgeEmptyBodySchema)) _body: Record<string, never>,
    @Res({ passthrough: true }) response: import('express').Response) {
    if (!file) throw new BadRequestException('No file uploaded');
    const result = await this.documentService.uploadVersion(kbId, id, file, req.user.id, { ifMatch, idempotencyKey });
    if (result.unchanged) response.status(200);
    response.setHeader('ETag', result.etag);
    return result;
  }

  @Get(':id/versions')
  @ApiOperation({ summary: '文档版本记录，不返回原件路径或哈希' })
  @ApiResponse({ status: 200, description: '安全版本数组' })
  async listVersions(@Param('knowledgeBaseId') kbId: string, @Param('id') id: string, @Request() req) {
    return this.documentService.listVersions(kbId, id, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: '获取知识库的文档列表' })
  @ApiResponse({ status: 200, description: '文档与当前生效版、最新版本及处理阶段' })
  async listDocuments(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Request() req,
  ) {
    return this.documentService.listDocumentsForUser(knowledgeBaseId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文档详情' })
  @ApiResponse({ status: 200, description: '安全版本化文档详情，包含当前强 ETag' })
  async getDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
    @Res({ passthrough: true }) response: import('express').Response,
  ) {
    const result = await this.documentService.getDocumentForUser(knowledgeBaseId, id, req.user.id);
    response.setHeader('ETag', result.etag);
    return result;
  }

  @Get(':id/preview')
  @ApiOperation({ summary: '当前生效版本解析块的分页只读预览，分页时固定 versionId' })
  @ApiResponse({ status: 200, description: '安全解析块、真实页码（如有）及当前 versionId；旧数据兼容处理片段' })
  @ApiResponse({ status: 409, description: 'DOCUMENT_NOT_READY' })
  async preview(@Param('knowledgeBaseId') kbId: string, @Param('id') id: string, @Request() req,
    @Query(new ZodValidationPipe(KnowledgePreviewQuerySchema)) query: Pick<KnowledgePageQuery, 'page' | 'pageSize'> & { versionId?: string }) {
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
  @HttpCode(202)
  @ApiOperation({ summary: '重新处理文档（重新解析和向量化）' })
  @ApiResponse({ status: 202, description: '同版本新处理代次已持久化' })
  async reprocessDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
    @Body(new ZodValidationPipe(KnowledgeEmptyBodySchema)) _body: Record<string, never>,
    @Headers('if-match') ifMatch: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: import('express').Response,
  ) {
    const result = await this.documentService.retry(knowledgeBaseId, id, req.user.id, { ifMatch, idempotencyKey });
    response.setHeader('ETag', result.etag);
    return result;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除文档' })
  @ApiResponse({ status: 204, description: '删除成功' })
  async deleteDocument(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
    @Headers('if-match') ifMatch: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    await this.documentService.deleteDocument(knowledgeBaseId, id, req.user.id, { ifMatch, idempotencyKey });
  }
}

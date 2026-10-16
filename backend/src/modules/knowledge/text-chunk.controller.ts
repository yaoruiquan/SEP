import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { KnowledgeNoStoreInterceptor } from './knowledge-no-store.interceptor';
import { KnowledgeChunkQuerySchema } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { TextChunkService } from './text-chunk.service';
import { CreateTextChunkDto, UpdateTextChunkDto } from './dto/text-chunk.dto';

@ApiTags('Knowledge - Text Chunks')
@ApiBearerAuth()
@UseGuards(KnowledgeAuthGuard)
@UseInterceptors(KnowledgeNoStoreInterceptor)
@ApiResponse({ status: 404, description: '资源不存在或不可访问' })
@Controller('knowledge-bases/:knowledgeBaseId/chunks')
export class TextChunkController {
  constructor(private textChunkService: TextChunkService) {}

  @Post()
  @ApiResponse({ status: 410, description: '手工写入已停用' })
  @ApiOperation({ summary: '创建文本片段' })
  async createTextChunk(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Body() dto: CreateTextChunkDto,
    @Request() req,
  ) {
    const userId = req.user.id;
    return this.textChunkService.createTextChunk(knowledgeBaseId, dto, userId);
  }

  @Get()
  @ApiResponse({ status: 200, description: '只读已处理片段列表' })
  @ApiOperation({ summary: '获取知识库的文本片段列表' })
  async listTextChunks(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Request() req,
    @Query(new ZodValidationPipe(KnowledgeChunkQuerySchema)) query?: { search?: string },
  ) {
    return this.textChunkService.listTextChunks(knowledgeBaseId, req.user.id, query?.search);
  }

  @Get(':id')
  @ApiResponse({ status: 200, description: '只读已处理片段' })
  @ApiOperation({ summary: '获取文本片段详情' })
  async getTextChunk(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.textChunkService.getTextChunk(knowledgeBaseId, id, req.user.id);
  }

  @Patch(':id')
  @ApiResponse({ status: 410, description: '手工写入已停用' })
  @ApiOperation({ summary: '更新文本片段' })
  async updateTextChunk(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTextChunkDto,
    @Request() req,
  ) {
    return this.textChunkService.updateTextChunk(knowledgeBaseId, id, dto, req.user.id);
  }

  @Delete(':id')
  @ApiResponse({ status: 410, description: '手工写入已停用' })
  @ApiOperation({ summary: '删除文本片段' })
  async deleteTextChunk(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    await this.textChunkService.deleteTextChunk(knowledgeBaseId, id, req.user.id);
    return { message: 'Text chunk deleted successfully' };
  }
}

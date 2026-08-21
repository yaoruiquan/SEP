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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TextChunkService } from './text-chunk.service';
import { CreateTextChunkDto, UpdateTextChunkDto } from './dto/text-chunk.dto';

@ApiTags('Knowledge - Text Chunks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge-bases/:knowledgeBaseId/chunks')
export class TextChunkController {
  constructor(private textChunkService: TextChunkService) {}

  @Post()
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
  @ApiOperation({ summary: '获取知识库的文本片段列表' })
  async listTextChunks(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Request() req,
    @Query('search') search?: string,
  ) {
    return this.textChunkService.listTextChunks(knowledgeBaseId, req.user.id, search);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文本片段详情' })
  async getTextChunk(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('id') id: string,
    @Request() req,
  ) {
    return this.textChunkService.getTextChunk(knowledgeBaseId, id, req.user.id);
  }

  @Patch(':id')
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

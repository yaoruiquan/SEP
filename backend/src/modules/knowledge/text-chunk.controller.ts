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
@Controller('knowledge/:knowledgeBaseId/chunks')
export class TextChunkController {
  constructor(private textChunkService: TextChunkService) {}

  @Post()
  @ApiOperation({ summary: '创建文本片段' })
  async createTextChunk(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Body() dto: CreateTextChunkDto,
    @Request() req,
  ) {
    const userId = req.user.userId;
    return this.textChunkService.createTextChunk(knowledgeBaseId, dto, userId);
  }

  @Get()
  @ApiOperation({ summary: '获取知识库的文本片段列表' })
  async listTextChunks(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Query('search') search?: string,
  ) {
    return this.textChunkService.listTextChunks(knowledgeBaseId, search);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取文本片段详情' })
  async getTextChunk(@Param('id') id: string) {
    return this.textChunkService.getTextChunk(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新文本片段' })
  async updateTextChunk(@Param('id') id: string, @Body() dto: UpdateTextChunkDto) {
    return this.textChunkService.updateTextChunk(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文本片段' })
  async deleteTextChunk(@Param('id') id: string) {
    await this.textChunkService.deleteTextChunk(id);
    return { message: 'Text chunk deleted successfully' };
  }
}

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KnowledgeSearchService } from './knowledge-search.service';
import {
  KnowledgeSearchDto,
  KnowledgeSearchDtoSchema,
  SearchByKnowledgeBaseDto,
  SearchByKnowledgeBaseDtoSchema,
} from '../../shared/knowledge-search.dto';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

@ApiTags('Knowledge Search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge-bases/search')
export class SearchController {
  constructor(private readonly searchService: KnowledgeSearchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '检索知识库内容（按雇佣关系授权）',
    description: '根据用户查询和雇佣关系 ID，检索该段雇佣关系被授权的所有知识库中的相关内容',
  })
  @ApiResponse({ status: 200, description: '返回检索结果列表' })
  @ApiResponse({ status: 401, description: '未授权' })
  async search(
    @Body(new ZodValidationPipe(KnowledgeSearchDtoSchema))
    dto: KnowledgeSearchDto,
  ) {
    const searchResponse = await this.searchService.search(
      dto.query,
      dto.subscriptionId,
      dto.topK,
      dto.scoreThreshold,
      dto.strategy,
    );

    return {
      query: dto.query,
      subscriptionId: dto.subscriptionId,
      strategy: searchResponse.strategy,
      durationMs: searchResponse.durationMs,
      results: searchResponse.results,
      count: searchResponse.count,
    };
  }

  @Post('by-knowledge-base')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '按知识库 ID 检索（不检查授权）',
    description: '直接指定知识库 ID 列表进行检索，用于测试和管理后台',
  })
  @ApiResponse({ status: 200, description: '返回检索结果列表' })
  @ApiResponse({ status: 401, description: '未授权' })
  async searchByKnowledgeBase(
    @Body(new ZodValidationPipe(SearchByKnowledgeBaseDtoSchema))
    dto: SearchByKnowledgeBaseDto,
  ) {
    const results = await this.searchService.searchByKnowledgeBase(
      dto.query,
      dto.knowledgeBaseIds,
      dto.topK,
      dto.scoreThreshold,
      dto.strategy,
    );

    return {
      query: dto.query,
      knowledgeBaseIds: dto.knowledgeBaseIds,
      results,
      count: results.length,
    };
  }
}

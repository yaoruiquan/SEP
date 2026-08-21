import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KnowledgeSearchService } from './knowledge-search.service';
import {
  KnowledgeSearchDto,
  KnowledgeSearchDtoSchema,
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
    @Request() req,
    @Body(new ZodValidationPipe(KnowledgeSearchDtoSchema))
    dto: KnowledgeSearchDto,
  ) {
    const searchResponse = await this.searchService.search(
      dto.query,
      req.user.id,
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

}

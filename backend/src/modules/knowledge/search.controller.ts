import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeMemberSearchDtoSchema, type KnowledgeMemberSearchDto } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { KnowledgeNoStoreInterceptor } from './knowledge-no-store.interceptor';

@ApiTags('Knowledge Search')
@ApiBearerAuth()
@UseGuards(KnowledgeAuthGuard)
@UseInterceptors(KnowledgeNoStoreInterceptor)
@Controller('knowledge-bases/search')
export class SearchController {
  constructor(private readonly searchService: KnowledgeSearchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '按真实企业成员权限检索知识库（第一批兼容响应）',
    description: '不接收订阅或员工绑定。响应为旧命中形状加documentId/documentName，不提供版本化来源标识。',
  })
  @ApiResponse({ status: 200, description: '返回检索结果列表' })
  @ApiResponse({ status: 401, description: '未授权' })
  async search(
    @Request() req,
    @Body(new ZodValidationPipe(KnowledgeMemberSearchDtoSchema))
    dto: KnowledgeMemberSearchDto,
  ) {
    const searchResponse = await this.searchService.searchForMember(req.user.id, dto);

    return {
      query: dto.query,
      strategy: searchResponse.strategy,
      durationMs: searchResponse.durationMs,
      results: searchResponse.results,
      count: searchResponse.count,
    };
  }

}

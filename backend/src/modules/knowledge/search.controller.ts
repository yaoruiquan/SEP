import {
  Controller,
  Post,
  Get,
  Param,
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
@Controller('knowledge-bases')
export class SearchController {
  constructor(private readonly searchService: KnowledgeSearchService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '按真实企业成员权限检索知识库',
    description: '检索范围由当前企业成员权限决定，响应包含版本化来源和可追溯定位。',
  })
  @ApiResponse({ status: 200, description: '返回检索结果列表' })
  @ApiResponse({ status: 401, description: '未授权' })
  async search(
    @Request() req,
    @Body(new ZodValidationPipe(KnowledgeMemberSearchDtoSchema))
    dto: KnowledgeMemberSearchDto,
  ) {
    const searchResponse = await this.searchService.searchForMember(req.user.id, dto);

    return searchResponse;
  }

  @Get(':knowledgeBaseId/sources/:sourceId')
  @ApiOperation({ summary: '查看检索来源片段' })
  @ApiResponse({ status: 200, description: '返回当前或仍保留的历史版本来源片段' })
  @ApiResponse({ status: 404, description: '来源不存在、已过期或不可访问' })
  async getSource(
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Param('sourceId') sourceId: string,
    @Request() req,
  ) {
    return this.searchService.getSource(req.user.id, knowledgeBaseId, sourceId);
  }

}

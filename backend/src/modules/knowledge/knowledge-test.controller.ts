import { Body, Controller, Get, GoneException, HttpCode, Param, Post, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { KnowledgeTestService } from './knowledge-test.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { KnowledgeNoStoreInterceptor } from './knowledge-no-store.interceptor';
import { KnowledgeRateLimitGuard } from './knowledge-rate-limit.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TestSearchDtoSchema, type TestSearchDto } from 'shared';

type AuthedRequest = { user: { id: string } };

@ApiTags('Knowledge - Compatibility Test & Status')
@ApiBearerAuth()
@UseGuards(KnowledgeAuthGuard)
@UseInterceptors(KnowledgeNoStoreInterceptor)
@ApiResponse({ status: 404, description: '资源不存在或不可访问' })
@Controller('knowledge-bases')
export class KnowledgeTestController {
  constructor(private readonly testService: KnowledgeTestService, private readonly policy: KnowledgeAccessPolicy) {}

  @Post(':id/test-search')
  @UseGuards(KnowledgeRateLimitGuard)
  @HttpCode(200)
  @ApiOperation({ summary: '管理员检索验证（第一批兼容接口）' })
  @ApiResponse({ status: 200, description: 'query/topK/scoreThreshold/strategy/hitCount/durationMs/results' })
  async testSearch(@Request() req: AuthedRequest, @Param('id') id: string,
    @Body(new ZodValidationPipe(TestSearchDtoSchema)) dto: TestSearchDto) {
    const viewer = await this.policy.assertManage(req.user.id, id);
    return this.testService.testSearch(id, viewer.enterpriseId, dto, req.user.id);
  }

  @Get(':id/documents/status')
  @SkipThrottle({ auth: true, chat: true })
  @ApiOperation({ summary: '文档处理状态汇总（第一批兼容接口）' })
  @ApiResponse({ status: 200, description: 'total/vectorized/pending/processing/ready/failed/documents[]' })
  async getDocumentStatus(@Request() req: AuthedRequest, @Param('id') id: string) {
    const viewer = await this.policy.assertRead(req.user.id, id);
    return this.testService.getDocumentStatus(id, viewer.enterpriseId);
  }

  @Post(':id/documents/batch-reprocess')
  @ApiOperation({ summary: '批量重处理已停用' })
  @ApiResponse({ status: 410, description: '零副作用，使用单文档重试' })
  async batchReprocess(@Request() req: AuthedRequest, @Param('id') id: string) {
    await this.policy.assertRead(req.user.id, id);
    throw new GoneException({ code: 'KNOWLEDGE_OPERATION_RETIRED', message: '请使用单文档重试' });
  }

  @Get(':id/analytics')
  @ApiOperation({ summary: '企业知识库分析已停用' })
  @ApiResponse({ status: 410, description: '零副作用' })
  async getAnalytics(@Request() req: AuthedRequest, @Param('id') id: string) {
    await this.policy.assertRead(req.user.id, id);
    throw new GoneException({ code: 'KNOWLEDGE_OPERATION_RETIRED', message: '企业知识库分析已停用' });
  }
}

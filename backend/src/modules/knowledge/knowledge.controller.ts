import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
  Query,
  HttpCode,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  KnowledgeBaseCreateDtoSchema,
  KnowledgeBaseUpdateDtoSchema,
  KnowledgeGrantMutationDtoSchema,
  KnowledgePageQuerySchema,
  type KnowledgeBaseCreateDto,
  type KnowledgeBaseUpdateDto,
  type KnowledgeGrantMutationDto,
  type KnowledgePageQuery,
} from 'shared';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeNoStoreInterceptor } from './knowledge-no-store.interceptor';
import { GoneException } from '@nestjs/common';

type AuthedRequest = { user: { id: string } };

@ApiTags('Knowledge Base')
@Controller('knowledge-bases')
@UseGuards(KnowledgeAuthGuard)
@UseInterceptors(KnowledgeNoStoreInterceptor)
@ApiBearerAuth()
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
  ) {}

  // ── 知识库 ────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: '获取本企业知识库列表' })
  @ApiResponse({ status: 200, description: '知识库列表' })
  async list(@Request() req: AuthedRequest,
    @Query(new ZodValidationPipe(KnowledgePageQuerySchema)) query: KnowledgePageQuery) {
    return this.knowledge.list(req.user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取知识库基础详情和当前成员权限' })
  @ApiResponse({ status: 200, description: '知识库详情' })
  @ApiResponse({ status: 404, description: '知识库不存在' })
  @ApiResponse({ status: 403, description: '无权访问' })
  async getById(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.getById(req.user.id, id);
  }

  @Post()
  @ApiOperation({ summary: '创建知识库' })
  @ApiResponse({ status: 201, description: '创建成功' })
  async create(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(KnowledgeBaseCreateDtoSchema))
    dto: KnowledgeBaseCreateDto,
  ) {
    return this.knowledge.create(req.user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新知识库信息' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 404, description: '知识库不存在' })
  async update(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(KnowledgeBaseUpdateDtoSchema))
    dto: KnowledgeBaseUpdateDto,
  ) {
    return this.knowledge.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '删除知识库' })
  @ApiResponse({ status: 204, description: '删除成功' })
  @ApiResponse({ status: 404, description: '知识库不存在' })
  async delete(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.delete(req.user.id, id);
  }

  @Post(':id/reindex')
  @ApiOperation({ summary: '已停用：企业手动重建知识库索引' })
  @ApiResponse({ status: 410, description: '已停用，零副作用' })
  async reindex(@Request() req: AuthedRequest, @Param('id') id: string) {
    await this.knowledge.getById(req.user.id, id);
    throw new GoneException({ code: 'KNOWLEDGE_OPERATION_RETIRED', message: '企业重建索引接口已停用' });
  }

  // ── 授权管理 ──────────────────────────────────────────────────────────────

  @Get(':id/grants')
  @ApiOperation({ summary: '获取知识库授权列表' })
  @ApiResponse({ status: 200, description: '授权列表' })
  async listGrants(@Request() req: AuthedRequest, @Param('id') id: string,
    @Query(new ZodValidationPipe(KnowledgePageQuerySchema)) query: KnowledgePageQuery) {
    return this.knowledge.listGrants(req.user.id, id, query);
  }

  // 静态前缀，放在 @Get(':id') 之后不会被它截走（那个只匹配单段路径）
  @Get('grants/by-subscription/:subscriptionId')
  @ApiOperation({ summary: '已停用：按雇佣关系获取知识库授权' })
  @ApiResponse({ status: 410, description: '旧订阅授权已停用，历史记录保留' })
  async listGrantsBySubscription(
    @Request() req: AuthedRequest,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.knowledge.listGrantsBySubscription(req.user.id, subscriptionId);
  }

  @Post(':id/grants')
  @HttpCode(200)
  @ApiOperation({ summary: '批量授权知识库给本企业真实成员' })
  @ApiResponse({ status: 200, description: 'addedMemberIds / existingMemberIds' })
  async createGrant(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(KnowledgeGrantMutationDtoSchema))
    dto: KnowledgeGrantMutationDto,
  ) {
    if (!('memberIds' in dto)) return this.knowledge.retireLegacyGrant(req.user.id, id);
    return this.knowledge.createGrant(req.user.id, id, dto);
  }

  @Delete(':id/grants/:memberId')
  @HttpCode(204)
  @ApiOperation({ summary: '撤销成员显式知识库授权' })
  @ApiResponse({ status: 204, description: '已撤销或原本未授权' })
  @ApiResponse({ status: 404, description: '库或成员不可访问' })
  async revokeMemberGrant(@Request() req: AuthedRequest, @Param('id') id: string,
    @Param('memberId') memberId: string) {
    await this.knowledge.revokeMemberGrant(req.user.id, id, memberId);
  }

  @Delete('grants/:grantId')
  @ApiOperation({ summary: '已停用：按旧授权记录撤销知识库权限' })
  @ApiResponse({ status: 410, description: '旧授权已停用，请按成员撤销权限' })
  async deleteGrant(
    @Request() req: AuthedRequest,
    @Param('grantId') grantId: string,
  ) {
    return this.knowledge.deleteGrant(req.user.id, grantId);
  }
}

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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  KnowledgeBaseCreateDtoSchema,
  KnowledgeBaseUpdateDtoSchema,
  KnowledgeGrantCreateDtoSchema,
  type KnowledgeBaseCreateDto,
  type KnowledgeBaseUpdateDto,
  type KnowledgeGrantCreateDto,
} from 'shared';
import { KnowledgeService } from './knowledge.service';

type AuthedRequest = { user: { id: string } };

@ApiTags('Knowledge Base')
@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  // ── 知识库 ────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: '获取本企业知识库列表' })
  @ApiResponse({ status: 200, description: '知识库列表' })
  async list(@Request() req: AuthedRequest) {
    return this.knowledge.list(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取知识库详情（含文档和授权）' })
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
  @ApiOperation({ summary: '删除知识库' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '知识库不存在' })
  async delete(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.delete(req.user.id, id);
  }

  // ── 授权管理 ──────────────────────────────────────────────────────────────

  @Get(':id/grants')
  @ApiOperation({ summary: '获取知识库授权列表' })
  @ApiResponse({ status: 200, description: '授权列表' })
  async listGrants(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.knowledge.listGrants(req.user.id, id);
  }

  // 静态前缀，放在 @Get(':id') 之后不会被它截走（那个只匹配单段路径）
  @Get('grants/by-subscription/:subscriptionId')
  @ApiOperation({ summary: '获取某段雇佣关系已被授权的知识库' })
  @ApiResponse({ status: 200, description: '授权列表' })
  async listGrantsBySubscription(
    @Request() req: AuthedRequest,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.knowledge.listGrantsBySubscription(req.user.id, subscriptionId);
  }

  @Post(':id/grants')
  @ApiOperation({ summary: '授权知识库给雇佣关系或部门' })
  @ApiResponse({ status: 201, description: '授权成功' })
  async createGrant(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(KnowledgeGrantCreateDtoSchema))
    dto: KnowledgeGrantCreateDto,
  ) {
    return this.knowledge.createGrant(req.user.id, id, dto);
  }

  @Delete('grants/:grantId')
  @ApiOperation({ summary: '撤销知识库授权' })
  @ApiResponse({ status: 200, description: '撤销成功' })
  async deleteGrant(
    @Request() req: AuthedRequest,
    @Param('grantId') grantId: string,
  ) {
    return this.knowledge.deleteGrant(req.user.id, grantId);
  }
}

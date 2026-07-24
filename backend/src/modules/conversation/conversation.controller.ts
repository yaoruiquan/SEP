import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  Res,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConversationService } from './conversation.service';
import { ConversationStreamService } from './conversation-stream.service';
import { ConversationCreateDto, ConversationUpdateDto, MessageSendDto } from 'shared';

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; role: string };
}

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly streamService: ConversationStreamService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建对话会话' })
  @ApiResponse({ status: 201, description: '会话创建成功' })
  async create(
    @Body() dto: ConversationCreateDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationService.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '获取当前用户的所有会话' })
  @ApiResponse({ status: 200, description: '会话列表' })
  async findAll(@Request() req: AuthenticatedRequest) {
    return this.conversationService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取会话详情及消息历史' })
  @ApiResponse({ status: 200, description: '会话详情' })
  @ApiResponse({ status: 404, description: '会话不存在' })
  async findOne(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '重命名会话' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async update(
    @Param('id') id: string,
    @Body() dto: ConversationUpdateDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除会话（级联删除消息）' })
  @ApiResponse({ status: 204, description: '删除成功' })
  async remove(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationService.remove(id, req.user.id);
  }

  /**
   * SSE 流式发消息
   * POST /conversations/:id/messages
   * Content-Type: text/event-stream
   */
  @Post(':id/messages')
  @ApiOperation({ summary: '发送消息（SSE 流式返回）' })
  @ApiResponse({ status: 200, description: 'SSE 事件流' })
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: MessageSendDto,
    @Request() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const generator = this.streamService.streamConversation(
        id,
        dto.content,
        req.user.id,
      );

      for await (const sseEvent of generator) {
        res.write(`event: ${sseEvent.event}\ndata: ${JSON.stringify(sseEvent.data)}\n\n`);
      }
    } catch (err) {
      this.logger.error(`SSE error for session ${id}`, err);
      res.write(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`);
    } finally {
      res.end();
    }
  }
}

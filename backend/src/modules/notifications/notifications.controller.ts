import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取通知列表' })
  async list(
    @Request() req,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = req.user.userId;
    return this.notificationsService.findByUser(
      userId,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: '获取未读通知数量' })
  async unreadCount(@Request() req) {
    const userId = req.user.userId;
    const count = await this.notificationsService.countUnread(userId);
    return { count };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '标记单条通知为已读' })
  async markAsRead(@Param('id') id: string, @Request() req) {
    const userId = req.user.userId;
    await this.notificationsService.markAsRead(id, userId);

    // 推送未读数更新
    const unreadCount = await this.notificationsService.countUnread(userId);
    await this.notificationsGateway.pushUnreadCount(userId, unreadCount);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '标记所有通知为已读' })
  async markAllAsRead(@Request() req) {
    const userId = req.user.userId;
    await this.notificationsService.markAllAsRead(userId);

    // 推送未读数更新
    await this.notificationsGateway.pushUnreadCount(userId, 0);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除通知' })
  async delete(@Param('id') id: string, @Request() req) {
    const userId = req.user.userId;
    await this.notificationsService.delete(id, userId);

    // 推送未读数更新
    const unreadCount = await this.notificationsService.countUnread(userId);
    await this.notificationsGateway.pushUnreadCount(userId, unreadCount);
  }

  @Delete('clear-read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '清空所有已读通知' })
  async clearRead(@Request() req) {
    const userId = req.user.userId;
    await this.notificationsService.clearRead(userId);
  }
}

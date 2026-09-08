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
import type { NotificationCategory } from './notifications.service';
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
    @Query('category') category?: NotificationCategory,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const userId = req.user.id;
    return this.notificationsService.findByUser(
      userId,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
      category,
      unreadOnly === 'true',
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: '获取未读通知数量' })
  async unreadCount(@Request() req, @Query('category') category?: NotificationCategory) {
    const userId = req.user.id;
    const count = await this.notificationsService.countUnread(userId, category);
    return { count };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '标记单条通知为已读' })
  async markAsRead(@Param('id') id: string, @Request() req) {
    const userId = req.user.id;
    await this.notificationsService.markAsRead(id, userId);

    // 推送未读数更新
    const unreadCount = await this.notificationsService.countUnread(userId);
    await this.notificationsGateway.pushUnreadCount(userId, unreadCount);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '标记所有通知为已读' })
  async markAllAsRead(@Request() req, @Query('category') category?: NotificationCategory) {
    const userId = req.user.id;
    await this.notificationsService.markAllAsRead(userId, category);

    // 推送未读数更新
    const unreadCount = await this.notificationsService.countUnread(userId);
    await this.notificationsGateway.pushUnreadCount(userId, unreadCount);
  }

  @Delete('clear-read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '清空所有已读通知' })
  async clearRead(@Request() req, @Query('category') category?: NotificationCategory) {
    const userId = req.user.id;
    await this.notificationsService.clearRead(userId, category);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除通知' })
  async delete(@Param('id') id: string, @Request() req) {
    const userId = req.user.id;
    await this.notificationsService.delete(id, userId);

    // 推送未读数更新
    const unreadCount = await this.notificationsService.countUnread(userId);
    await this.notificationsGateway.pushUnreadCount(userId, unreadCount);
  }
}

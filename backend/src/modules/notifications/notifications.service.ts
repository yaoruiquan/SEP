import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedType?: string;
  relatedId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建通知
   */
  async create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({
      data: dto,
    });
  }

  /**
   * 批量创建通知（给多个用户）
   */
  async createBatch(userIds: string[], notification: Omit<CreateNotificationDto, 'userId'>) {
    return this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, ...notification })),
    });
  }

  /**
   * 获取用户的通知列表
   */
  async findByUser(userId: string, limit = 50, offset = 0) {
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return { items, total };
  }

  /**
   * 获取未读通知数量
   */
  async countUnread(userId: string) {
    return this.prisma.notification.count({
      where: { userId, read: false },
    });
  }

  /**
   * 标记单条通知为已读
   */
  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  /**
   * 标记所有通知为已读
   */
  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  /**
   * 删除通知
   */
  async delete(id: string, userId: string) {
    return this.prisma.notification.deleteMany({
      where: { id, userId },
    });
  }

  /**
   * 清空所有已读通知
   */
  async clearRead(userId: string) {
    return this.prisma.notification.deleteMany({
      where: { userId, read: true },
    });
  }
}

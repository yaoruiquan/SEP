import { BadRequestException, forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType, Prisma } from '@prisma/client';
import { NotificationsGateway } from './notifications.gateway';

export type NotificationCategory = 'SYSTEM' | 'USAGE_ALERT' | 'SECURITY' | 'APPROVAL';
export type NotificationSeverity = 'INFO' | 'WARNING' | 'ERROR';

const CATEGORY_TYPES: Record<NotificationCategory, NotificationType[]> = {
  SYSTEM: ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SKILL_VERSION_UPDATED', 'CONTRIBUTION_REWARD_CREDITED', 'SUBSCRIPTION_EXPIRING'],
  USAGE_ALERT: ['ALLOWANCE_WARNING', 'ALLOWANCE_EXHAUSTED', 'WALLET_LOW_BALANCE'],
  SECURITY: [],
  APPROVAL: [
    'SUBSCRIPTION_REQUEST_CREATED',
    'SUBSCRIPTION_REQUEST_APPROVED',
    'SUBSCRIPTION_REQUEST_REJECTED',
    'CONTRIBUTION_ENTERPRISE_APPROVED',
    'CONTRIBUTION_ENTERPRISE_REJECTED',
    'CONTRIBUTION_PLATFORM_APPROVED',
    'CONTRIBUTION_PLATFORM_REJECTED',
  ],
};

const TYPE_CATEGORY = Object.fromEntries(
  Object.entries(CATEGORY_TYPES).flatMap(([category, types]) =>
    types.map((type) => [type, category]),
  ),
) as Record<NotificationType, NotificationCategory>;

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedType?: string;
  relatedId?: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  actionUrl?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, @Optional() @Inject(forwardRef(() => NotificationsGateway)) private readonly gateway?: NotificationsGateway) {}

  /**
   * 创建通知
   */
  async create(dto: CreateNotificationDto) {
    const created = await this.prisma.notification.create({
      data: this.enrich(dto),
    });
    await this.gateway?.pushToUser(dto.userId, { ...created, category: created.category ?? TYPE_CATEGORY[created.type], severity: created.severity ?? this.resolveSeverity(created.type) });
    if (this.gateway) await this.gateway.pushUnreadCount(dto.userId, await this.countUnread(dto.userId));
    return created;
  }

  /**
   * 批量创建通知（给多个用户）
   */
  async createBatch(userIds: string[], notification: Omit<CreateNotificationDto, 'userId'>) {
    const result = await this.prisma.notification.createMany({
      data: userIds.map((userId) => this.enrich({ userId, ...notification })),
    });
    if (this.gateway) {
      await Promise.all(userIds.map(async (userId) => {
        await this.gateway!.pushToUser(userId, { ...notification, userId, category: notification.category ?? TYPE_CATEGORY[notification.type], severity: notification.severity ?? this.resolveSeverity(notification.type) });
        await this.gateway!.pushUnreadCount(userId, await this.countUnread(userId));
      }));
    }
    return result;
  }

  /**
   * 获取用户的通知列表
   */
  async findByUser(
    userId: string,
    limit = 50,
    offset = 0,
    category?: NotificationCategory,
    unreadOnly = false,
  ) {
    const where = this.buildWhere(userId, category, unreadOnly);
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        category: item.category ?? TYPE_CATEGORY[item.type],
        severity: item.severity ?? this.resolveSeverity(item.type),
      })),
      total,
    };
  }

  /**
   * 获取未读通知数量
   */
  async countUnread(userId: string, category?: NotificationCategory) {
    return this.prisma.notification.count({
      where: this.buildWhere(userId, category, true),
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
  async markAllAsRead(userId: string, category?: NotificationCategory) {
    return this.prisma.notification.updateMany({
      where: this.buildWhere(userId, category, true),
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
  async clearRead(userId: string, category?: NotificationCategory) {
    return this.prisma.notification.deleteMany({
      where: this.buildWhere(userId, category, false, true),
    });
  }

  private buildWhere(
    userId: string,
    category?: NotificationCategory,
    unreadOnly = false,
    readOnly = false,
  ): Prisma.NotificationWhereInput {
    if (category && !CATEGORY_TYPES[category]) {
      throw new BadRequestException(`Unsupported notification category: ${category}`);
    }
    const legacyTypeFilter = category
      ? { type: { in: CATEGORY_TYPES[category] } }
      : undefined;
    const categoryFilter = category
      ? {
          OR: [
            { category },
            ...(CATEGORY_TYPES[category].length > 0
              ? [{ category: null, ...legacyTypeFilter }]
              : []),
          ],
        }
      : {};

    return {
      userId,
      ...categoryFilter,
      ...(unreadOnly ? { read: false } : {}),
      ...(readOnly ? { read: true } : {}),
    };
  }

  private enrich(dto: CreateNotificationDto) {
    return {
      ...dto,
      category: dto.category ?? TYPE_CATEGORY[dto.type] ?? 'SYSTEM',
      severity: dto.severity ?? this.resolveSeverity(dto.type),
    };
  }

  private resolveSeverity(type: NotificationType): NotificationSeverity {
    if (type === 'ERROR') return 'ERROR';
    if (
      type === 'WARNING' ||
      type === 'ALLOWANCE_WARNING' ||
      type === 'ALLOWANCE_EXHAUSTED' ||
      type === 'WALLET_LOW_BALANCE'
    ) {
      return 'WARNING';
    }
    return 'INFO';
  }
}

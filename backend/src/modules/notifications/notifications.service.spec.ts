import { BadRequestException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let prisma: any;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new NotificationsService(prisma);
  });

  it('按审批分类过滤列表，并为返回项补充分类和严重程度', async () => {
    prisma.notification.findMany.mockResolvedValue([
      {
        id: 'notification-1',
        userId: 'user-1',
        type: 'SUBSCRIPTION_REQUEST_CREATED',
        title: '新的使用申请',
        message: '成员申请使用员工',
        read: false,
        createdAt: new Date('2026-09-08T00:00:00.000Z'),
      },
    ]);
    prisma.notification.count.mockResolvedValue(1);

    const result = await service.findByUser('user-1', 20, 0, 'APPROVAL');

    const expectedWhere = {
      userId: 'user-1',
      OR: [
        { category: 'APPROVAL' },
        {
          category: null,
          type: {
            in: [
              'SUBSCRIPTION_REQUEST_CREATED',
              'SUBSCRIPTION_REQUEST_APPROVED',
              'SUBSCRIPTION_REQUEST_REJECTED',
            ],
          },
        },
      ],
    };
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, take: 20, skip: 0 }),
    );
    expect(prisma.notification.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result.items[0]).toEqual(
      expect.objectContaining({ category: 'APPROVAL', severity: 'INFO' }),
    );
  });

  it('创建通知时自动持久化分类和严重级别', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'notification-1' });

    await service.create({
      userId: 'user-1',
      type: 'ALLOWANCE_EXHAUSTED',
      title: '额度已用尽',
      message: '请联系管理员',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'USAGE_ALERT',
        severity: 'WARNING',
      }),
    });
  });

  it('按用量分类统计、已读和清理，不影响其他类别', async () => {
    const usageTypes = [
      'ALLOWANCE_WARNING',
      'ALLOWANCE_EXHAUSTED',
      'WALLET_LOW_BALANCE',
    ];

    await service.countUnread('user-1', 'USAGE_ALERT');
    await service.markAllAsRead('user-1', 'USAGE_ALERT');
    await service.clearRead('user-1', 'USAGE_ALERT');

    const expectedUsageWhere = {
      userId: 'user-1',
      OR: [
        { category: 'USAGE_ALERT' },
        { category: null, type: { in: usageTypes } },
      ],
      read: false,
    };
    expect(prisma.notification.count).toHaveBeenCalledWith({ where: expectedUsageWhere });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: expectedUsageWhere,
      data: { read: true },
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { ...expectedUsageWhere, read: true },
    });
  });

  it('安全分类在尚无安全事件类型时返回空类型集合', async () => {
    await service.findByUser('user-1', 20, 0, 'SECURITY');

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', OR: [{ category: 'SECURITY' }] },
      }),
    );
  });

  it('拒绝未知分类，避免静默返回错误数据', async () => {
    await expect(
      service.findByUser('user-1', 20, 0, 'UNKNOWN' as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

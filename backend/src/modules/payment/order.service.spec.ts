import { Test, TestingModule } from '@nestjs/testing';
import { OrderService } from './order.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('OrderService', () => {
  let service: OrderService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      cartItem: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      order: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription: {
        upsert: jest.fn(),
      },
      digitalEmployee: {
        findUnique: jest.fn(),
      },
      computeAccount: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      computeTransaction: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('createFromCart', () => {
    it('购物车为空应拒绝', async () => {
      prisma.cartItem.findMany.mockResolvedValue([]);

      await expect(
        service.createFromCart('ent-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('购物车中存在未审核员工应拒绝', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        {
          employeeId: 'emp-1',
          periodMonths: 12,
          employee: {
            id: 'emp-1',
            name: '销售助手',
            annualPriceCNY: new Decimal(5000),
            includedComputeCNY: new Decimal(1000),
            status: 'DRAFT',
          },
        },
      ]);

      await expect(
        service.createFromCart('ent-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('应正确创建订单并计算金额', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        {
          enterpriseId: 'ent-1',
          employeeId: 'emp-1',
          periodMonths: 12,
          employee: {
            id: 'emp-1',
            name: '销售助手',
            annualPriceCNY: new Decimal(5000),
            includedComputeCNY: new Decimal(1000),
            status: 'APPROVED',
          },
        },
      ]);

      prisma.order.create.mockResolvedValue({
        id: 'order-1',
        orderNo: '20260811120000123456',
        totalAmount: new Decimal(5000),
      });

      const result = await service.createFromCart('ent-1', 'user-1');

      expect(prisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          enterpriseId: 'ent-1',
          createdBy: 'user-1',
          status: 'PENDING',
          totalAmount: expect.any(Decimal),
          items: {
            create: [
              expect.objectContaining({
                employeeId: 'emp-1',
                employeeName: '销售助手',
                unitPrice: expect.any(Decimal),
                periodMonths: 12,
                quantity: 1,
              }),
            ],
          },
        }),
        include: expect.any(Object),
      });

      expect(result.id).toBe('order-1');
    });

    it('总金额不再乘数量 —— 一员工一份，只按周期折算', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        {
          enterpriseId: 'ent-1',
          employeeId: 'emp-1',
          periodMonths: 6,
          employee: {
            id: 'emp-1',
            name: '销售助手',
            annualPriceCNY: new Decimal(5000),
            includedComputeCNY: new Decimal(1000),
            status: 'APPROVED',
          },
        },
      ]);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });

      await service.createFromCart('ent-1', 'user-1');

      const data = prisma.order.create.mock.calls[0][0].data;
      // 5000 * (6/12) = 2500
      expect(data.totalAmount.toString()).toBe('2500');
      // 赠送算力取单份，不随周期或数量放大
      expect(
        data.items.create[0].includedComputeCNY.toString(),
      ).toBe('1000');
    });
  });

  describe('findOne', () => {
    it('订单不存在应返回 404', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('order-999', 'ent-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('跨租户访问应返回 404', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        enterpriseId: 'ent-other',
      });

      await expect(
        service.findOne('order-1', 'ent-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('应成功返回订单详情', async () => {
      const mockOrder = {
        id: 'order-1',
        enterpriseId: 'ent-1',
        orderNo: '20260811120000123456',
        totalAmount: new Decimal(10000),
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await service.findOne('order-1', 'ent-1');

      expect(result).toEqual(mockOrder);
    });
  });

  describe('fulfill', () => {
    it('订单不存在应返回 404', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.fulfill('order-999', 'alipay-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('已支付订单应跳过重复处理', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'PAID',
      });

      const result = await service.fulfill('order-1', 'alipay-123');

      expect(result.status).toBe('PAID');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('非 PENDING 订单应拒绝履约', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'CLOSED',
      });

      await expect(
        service.fulfill('order-1', 'alipay-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('应成功履约并完成所有操作', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNo: '20260811120000123456',
        enterpriseId: 'ent-1',
        status: 'PENDING',
        items: [
          {
            id: 'item-1',
            employeeId: 'emp-1',
            employeeName: '销售助手',
            periodMonths: 12,
            includedComputeCNY: new Decimal(2000),
            employee: {},
          },
        ],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.order.update.mockResolvedValue({ ...mockOrder, status: 'PAID' });
      prisma.subscription.upsert.mockResolvedValue({ id: 'sub-1' });
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: '2.1.0' });
      prisma.computeAccount.findUnique.mockResolvedValue({
        id: 'acc-1',
        balance: 5000,
      });
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.fulfill('order-1', 'alipay-123');

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          status: 'PAID',
          payTradeNo: 'alipay-123',
          paidAt: expect.any(Date),
        }),
      });

      expect(prisma.subscription.upsert).toHaveBeenCalled();
      expect(prisma.computeAccount.update).toHaveBeenCalled();
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { enterpriseId: 'ent-1' },
      });
    });

    it('❗履约只建雇佣关系，不再按数量创建实例', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNo: '20260811120000123456',
        enterpriseId: 'ent-1',
        status: 'PENDING',
        items: [
          {
            id: 'item-1',
            employeeId: 'emp-1',
            employeeName: '销售助手',
            periodMonths: 12,
            includedComputeCNY: new Decimal(0),
            employee: {},
          },
        ],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.order.update.mockResolvedValue({ ...mockOrder, status: 'PAID' });
      prisma.subscription.upsert.mockResolvedValue({ id: 'sub-1' });
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: '2.1.0' });
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.fulfill('order-1', 'alipay-123');

      // 一个订单项 → 恰好一次 upsert，不循环建实例
      expect(prisma.subscription.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.employeeInstance).toBeUndefined();
    });

    it('雇佣关系锁定履约时刻的模板版本，而非写死版本号', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNo: '20260811120000123456',
        enterpriseId: 'ent-1',
        status: 'PENDING',
        items: [
          {
            id: 'item-1',
            employeeId: 'emp-1',
            employeeName: '销售助手',
            periodMonths: 12,
            includedComputeCNY: new Decimal(0),
            employee: {},
          },
        ],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.order.update.mockResolvedValue({ ...mockOrder, status: 'PAID' });
      prisma.subscription.upsert.mockResolvedValue({ id: 'sub-1' });
      prisma.digitalEmployee.findUnique.mockResolvedValue({ version: '2.1.0' });
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.fulfill('order-1', 'alipay-123');

      const upsertArg = prisma.subscription.upsert.mock.calls[0][0];
      expect(upsertArg.create).toMatchObject({
        enterpriseId: 'ent-1',
        employeeId: 'emp-1',
        status: 'ACTIVE',
        templateVersion: '2.1.0',
        name: '销售助手',
      });
    });

    it('订单项对应的员工已被删除时报 404，不落半份雇佣关系', async () => {
      const mockOrder = {
        id: 'order-1',
        orderNo: '20260811120000123456',
        enterpriseId: 'ent-1',
        status: 'PENDING',
        items: [
          {
            id: 'item-1',
            employeeId: 'emp-gone',
            employeeName: '销售助手',
            periodMonths: 12,
            includedComputeCNY: new Decimal(0),
            employee: {},
          },
        ],
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.order.update.mockResolvedValue({ ...mockOrder, status: 'PAID' });
      prisma.digitalEmployee.findUnique.mockResolvedValue(null);

      await expect(
        service.fulfill('order-1', 'alipay-123'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });
  });
});

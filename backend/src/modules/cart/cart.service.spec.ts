import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionFulfillmentService } from '../subscription-fulfillment/subscription-fulfillment.service';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';

describe('CartService', () => {
  let service: CartService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      cartItem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      digitalEmployee: {
        findUnique: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prisma },
        {
          // 购物车展示的赠送算力要和下单/履约同源（员工级配置 > 系统默认值）。
          // 默认直接回落员工级配置，未配置时按 0。
          provide: SubscriptionFulfillmentService,
          useValue: {
            resolveGiftCNY: jest.fn(async (override: unknown) =>
              override === null || override === undefined ? 0 : Number(override),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  describe('getCart', () => {
    it('应返回空购物车', async () => {
      prisma.cartItem.findMany.mockResolvedValue([]);

      const result = await service.getCart('ent-1');

      expect(result).toEqual({
        items: [],
        totalAmount: 0,
        totalIncludedCompute: 0,
        itemCount: 0,
      });
    });

    it('应计算小计和总价', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        {
          id: 'cart-1',
          enterpriseId: 'ent-1',
          employeeId: 'emp-1',
          periodMonths: 12,
          createdAt: new Date(),
          employee: {
            id: 'emp-1',
            name: '销售助手',
            avatar: null,
            annualPriceCNY: 5000,
            includedComputeCNY: 1000,
          },
        },
      ]);

      const result = await service.getCart('ent-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].subtotal).toBe(5000); // 5000 * (12/12)
      expect(result.items[0].includedComputeCNY).toBe(1000);
      expect(result.totalAmount).toBe(5000);
      expect(result.totalIncludedCompute).toBe(1000);
    });

    it('小计按周期折算 —— 半年只付一半', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        {
          id: 'cart-1',
          enterpriseId: 'ent-1',
          employeeId: 'emp-1',
          periodMonths: 6,
          createdAt: new Date(),
          employee: {
            id: 'emp-1',
            name: '销售助手',
            avatar: null,
            annualPriceCNY: 5000,
            includedComputeCNY: 1000,
          },
        },
      ]);

      const result = await service.getCart('ent-1');

      expect(result.items[0].subtotal).toBe(2500); // 5000 * (6/12)
      // 赠送算力不随周期折算
      expect(result.items[0].includedComputeCNY).toBe(1000);
    });

    it('quantity 恒为 1 —— 收敛后一员工一雇佣关系', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        {
          id: 'cart-1',
          enterpriseId: 'ent-1',
          employeeId: 'emp-1',
          periodMonths: 12,
          createdAt: new Date(),
          employee: {
            id: 'emp-1',
            name: '销售助手',
            avatar: null,
            annualPriceCNY: 5000,
            includedComputeCNY: 1000,
          },
        },
      ]);

      const result = await service.getCart('ent-1');

      expect(result.items[0].quantity).toBe(1);
    });
  });

  describe('addToCart', () => {
    it('未审核员工应拒绝加车', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'DRAFT',
      });

      await expect(
        service.addToCart('ent-1', 'user-1', {
          employeeId: 'emp-1',
          periodMonths: 12,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('已订阅员工应拒绝加车', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
      });
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
      });

      await expect(
        service.addToCart('ent-1', 'user-1', {
          employeeId: 'emp-1',
          periodMonths: 12,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('❗已在购物车应拒绝而非累加 —— 一员工一雇佣关系，买多份无意义', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
      });
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.cartItem.findUnique.mockResolvedValue({ id: 'cart-1' });

      await expect(
        service.addToCart('ent-1', 'user-1', {
          employeeId: 'emp-1',
          periodMonths: 12,
        }),
      ).rejects.toThrow(ConflictException);

      // 不能悄悄改成 update
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
      expect(prisma.cartItem.create).not.toHaveBeenCalled();
    });

    it('已过期订阅可以重新加车 —— 只有 ACTIVE 才算已雇佣', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
      });
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: 'EXPIRED',
      });
      prisma.cartItem.findUnique.mockResolvedValue(null);
      prisma.cartItem.create.mockResolvedValue({ id: 'cart-new' });

      const result = await service.addToCart('ent-1', 'user-1', {
        employeeId: 'emp-1',
        periodMonths: 12,
      });

      expect(result.message).toContain('已加入购物车');
    });

    it('首次加车应创建记录，且不写 quantity', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
      });
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.cartItem.findUnique.mockResolvedValue(null);
      prisma.cartItem.create.mockResolvedValue({
        id: 'cart-new',
      });

      const result = await service.addToCart('ent-1', 'user-1', {
        employeeId: 'emp-1',
        periodMonths: 12,
      });

      expect(result.message).toContain('已加入购物车');
      const createArg = prisma.cartItem.create.mock.calls[0][0];
      expect(createArg.data).not.toHaveProperty('quantity');
      expect(createArg.data).toMatchObject({
        enterpriseId: 'ent-1',
        employeeId: 'emp-1',
        periodMonths: 12,
        addedBy: 'user-1',
      });
    });
  });

  describe('removeCartItem', () => {
    it('购物车项不存在应返回 404', async () => {
      prisma.cartItem.findUnique.mockResolvedValue(null);

      await expect(
        service.removeCartItem('ent-1', 'cart-999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('不属于本企业的购物车项应返回 404', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        id: 'cart-1',
        enterpriseId: 'ent-other',
      });

      await expect(
        service.removeCartItem('ent-1', 'cart-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('应成功删除', async () => {
      prisma.cartItem.findUnique.mockResolvedValue({
        id: 'cart-1',
        enterpriseId: 'ent-1',
      });
      prisma.cartItem.delete.mockResolvedValue({});

      await service.removeCartItem('ent-1', 'cart-1');

      expect(prisma.cartItem.delete).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
      });
    });
  });

  describe('clearCart', () => {
    it('应清空购物车并返回删除数量', async () => {
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.clearCart('ent-1');

      expect(result.deletedCount).toBe(3);
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { enterpriseId: 'ent-1' },
      });
    });
  });
});

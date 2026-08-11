import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { PrismaService } from '../../prisma/prisma.service';
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
          quantity: 2,
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
      expect(result.items[0].subtotal).toBe(10000); // 5000 * 2 * (12/12)
      expect(result.items[0].includedComputeCNY).toBe(2000); // 1000 * 2
      expect(result.totalAmount).toBe(10000);
      expect(result.totalIncludedCompute).toBe(2000);
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
          quantity: 1,
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
          quantity: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('已在购物车应累加数量', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'APPROVED',
      });
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.cartItem.findUnique.mockResolvedValue({
        id: 'cart-1',
        quantity: 1,
      });
      prisma.cartItem.update.mockResolvedValue({
        id: 'cart-1',
        quantity: 2,
      });

      const result = await service.addToCart('ent-1', 'user-1', {
        employeeId: 'emp-1',
        periodMonths: 12,
        quantity: 1,
      });

      expect(result.message).toContain('已更新购物车数量');
      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
        data: expect.objectContaining({ quantity: 2 }),
      });
    });

    it('首次加车应创建记录', async () => {
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
        quantity: 1,
      });

      expect(result.message).toContain('已加入购物车');
      expect(prisma.cartItem.create).toHaveBeenCalled();
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

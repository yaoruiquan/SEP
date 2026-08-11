import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddToCartDto,
  UpdateCartItemDto,
  CartSummaryResponse,
  CartItemResponse,
} from './dto/cart.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 列出本企业购物车（含小计/总计）
   */
  async getCart(enterpriseId: string): Promise<CartSummaryResponse> {
    const cartItems = await this.prisma.cartItem.findMany({
      where: { enterpriseId },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            avatar: true,
            annualPriceCNY: true,
            includedComputeCNY: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const items: CartItemResponse[] = cartItems.map((item) => {
      const unitPrice = item.employee.annualPriceCNY
        ? parseFloat(item.employee.annualPriceCNY.toString())
        : 0;
      const includedComputePerUnit = item.employee.includedComputeCNY
        ? parseFloat(item.employee.includedComputeCNY.toString())
        : 0;

      // 小计 = 单价 × 数量 × (周期月数 / 12)
      const subtotal =
        unitPrice * item.quantity * (item.periodMonths / 12);
      // 赠送算力 = 单份算力 × 数量
      const includedComputeCNY = includedComputePerUnit * item.quantity;

      return {
        id: item.id,
        employeeId: item.employee.id,
        employeeName: item.employee.name,
        employeeAvatar: item.employee.avatar,
        unitPrice,
        periodMonths: item.periodMonths,
        quantity: item.quantity,
        subtotal,
        includedComputeCNY,
        addedAt: item.createdAt,
      };
    });

    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
    const totalIncludedCompute = items.reduce(
      (sum, item) => sum + item.includedComputeCNY,
      0,
    );

    return {
      items,
      totalAmount,
      totalIncludedCompute,
      itemCount: items.length,
    };
  }

  /**
   * 加入购物车（已在购物车则累加 quantity）
   */
  async addToCart(
    enterpriseId: string,
    userId: string,
    dto: AddToCartDto,
  ): Promise<{ id: string; message: string }> {
    // 1. 校验模板存在且已审核通过
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException('数字员工不存在');
    }

    if (employee.status !== 'APPROVED') {
      throw new BadRequestException('该数字员工尚未审核通过，无法加入购物车');
    }

    // 2. 校验是否已有 ACTIVE 订阅
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: {
        enterpriseId_employeeId: {
          enterpriseId,
          employeeId: dto.employeeId,
        },
      },
    });

    if (existingSubscription && existingSubscription.status === 'ACTIVE') {
      throw new ConflictException('已雇佣该硅基员工，无法重复加入购物车');
    }

    // 3. 查找是否已在购物车
    const existing = await this.prisma.cartItem.findUnique({
      where: {
        enterpriseId_employeeId: {
          enterpriseId,
          employeeId: dto.employeeId,
        },
      },
    });

    if (existing) {
      // 累加数量
      const updated = await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: existing.quantity + dto.quantity,
          periodMonths: dto.periodMonths, // 更新为最新的周期
          updatedAt: new Date(),
        },
      });
      return { id: updated.id, message: '已更新购物车数量' };
    }

    // 4. 新增
    const cartItem = await this.prisma.cartItem.create({
      data: {
        enterpriseId,
        employeeId: dto.employeeId,
        periodMonths: dto.periodMonths,
        quantity: dto.quantity,
        addedBy: userId,
      },
    });

    return { id: cartItem.id, message: '已加入购物车' };
  }

  /**
   * 更新购物车项（改数量/周期）
   */
  async updateCartItem(
    enterpriseId: string,
    itemId: string,
    dto: UpdateCartItemDto,
  ): Promise<void> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundException('购物车项不存在');
    }

    if (item.enterpriseId !== enterpriseId) {
      throw new NotFoundException('购物车项不存在');
    }

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: {
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.periodMonths !== undefined && {
          periodMonths: dto.periodMonths,
        }),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 移除购物车项
   */
  async removeCartItem(enterpriseId: string, itemId: string): Promise<void> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundException('购物车项不存在');
    }

    if (item.enterpriseId !== enterpriseId) {
      throw new NotFoundException('购物车项不存在');
    }

    await this.prisma.cartItem.delete({
      where: { id: itemId },
    });
  }

  /**
   * 清空购物车
   */
  async clearCart(enterpriseId: string): Promise<{ deletedCount: number }> {
    const result = await this.prisma.cartItem.deleteMany({
      where: { enterpriseId },
    });

    return { deletedCount: result.count };
  }
}

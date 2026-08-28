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
import { SubscriptionFulfillmentService } from '../subscription-fulfillment/subscription-fulfillment.service';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: SubscriptionFulfillmentService,
  ) {}

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

    // 赠送算力走与下单/履约同一个解析器（员工级配置 > 系统默认值）。
    // 若这里直接读 includedComputeCNY，未配置的员工会显示 ¥0 而实际赠送了默认值。
    const items: CartItemResponse[] = await Promise.all(
      cartItems.map(async (item) => {
        const unitPrice = item.employee.annualPriceCNY
          ? parseFloat(item.employee.annualPriceCNY.toString())
          : 0;

        return {
          id: item.id,
          employeeId: item.employee.id,
          employeeName: item.employee.name,
          employeeAvatar: item.employee.avatar,
          unitPrice,
          periodMonths: item.periodMonths,
          quantity: 1,
          // 小计 = 单价 × (周期月数 / 12)
          subtotal: unitPrice * (item.periodMonths / 12),
          includedComputeCNY: await this.fulfillment.resolveGiftCNY(
            item.employee.includedComputeCNY,
          ),
          addedAt: item.createdAt,
        };
      }),
    );

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
   * 加入购物车。
   *
   * 收敛后「一企业一员工一雇佣关系」，同一员工买多份没有意义，
   * 故重复加车直接 409，而非累加数量。
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
      // 已在购物车，提示不能重复加入
      throw new ConflictException('该员工已在购物车中');
    }

    // 4. 新增
    const cartItem = await this.prisma.cartItem.create({
      data: {
        enterpriseId,
        employeeId: dto.employeeId,
        periodMonths: dto.periodMonths,
        addedBy: userId,
      },
    });

    return { id: cartItem.id, message: '已加入购物车' };
  }

  /**
   * 更新购物车项（改周期）
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

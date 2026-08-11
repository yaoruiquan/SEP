import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 从购物车创建订单
   */
  async createFromCart(enterpriseId: string, createdBy: string) {
    // 1. 获取购物车内容
    const cartItems = await this.prisma.cartItem.findMany({
      where: { enterpriseId },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            annualPriceCNY: true,
            includedComputeCNY: true,
            status: true,
          },
        },
      },
    });

    if (cartItems.length === 0) {
      throw new BadRequestException('购物车为空，无法创建订单');
    }

    // 2. 校验所有员工都是已审核状态
    const unapprovedEmployees = cartItems.filter(
      (item) => item.employee.status !== 'APPROVED',
    );
    if (unapprovedEmployees.length > 0) {
      throw new BadRequestException(
        `购物车中存在未审核员工: ${unapprovedEmployees.map((i) => i.employee.name).join(', ')}`,
      );
    }

    // 3. 生成订单号（格式：yyyyMMddHHmmss + 6位随机数）
    const orderNo = this.generateOrderNo();

    // 4. 计算总金额
    let totalAmount = new Decimal(0);
    const orderItems = cartItems.map((cartItem) => {
      const unitPrice = cartItem.employee.annualPriceCNY || new Decimal(0);
      const periodFactor = new Decimal(cartItem.periodMonths).div(12);
      const subtotal = unitPrice.mul(cartItem.quantity).mul(periodFactor);
      totalAmount = totalAmount.add(subtotal);

      return {
        employeeId: cartItem.employeeId,
        employeeName: cartItem.employee.name,
        unitPrice,
        periodMonths: cartItem.periodMonths,
        quantity: cartItem.quantity,
        includedComputeCNY: cartItem.employee.includedComputeCNY.mul(
          cartItem.quantity,
        ),
      };
    });

    // 5. 创建订单
    const order = await this.prisma.order.create({
      data: {
        orderNo,
        enterpriseId,
        createdBy,
        status: 'PENDING',
        totalAmount,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: {
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                avatar: true,
                description: true,
              },
            },
          },
        },
      },
    });

    this.logger.log(
      `订单 ${orderNo} 已创建，企业 ${enterpriseId}，金额 ${totalAmount} 元`,
    );

    return order;
  }

  /**
   * 查询订单列表
   */
  async findAll(
    enterpriseId: string,
    query: { page?: number; limit?: number; status?: string },
  ) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      enterpriseId,
      ...(status && { status }),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              employee: {
                select: { id: true, name: true, avatar: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 查询单个订单
   */
  async findOne(orderId: string, enterpriseId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                avatar: true,
                description: true,
              },
            },
          },
        },
      },
    });

    if (!order || order.enterpriseId !== enterpriseId) {
      throw new NotFoundException('订单不存在');
    }

    return order;
  }

  /**
   * 按订单号查询订单
   */
  async findByOrderNo(orderNo: string) {
    return this.prisma.order.findUnique({
      where: { orderNo },
      include: {
        items: {
          include: {
            employee: true,
          },
        },
      },
    });
  }

  /**
   * 订单履约（支付成功后调用）
   * 必须在一个事务中完成：订阅生效 + 算力充值 + 清空购物车
   */
  async fulfill(orderId: string, payTradeNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { employee: true } } },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status === 'PAID') {
      this.logger.warn(`订单 ${order.orderNo} 已履约，跳过重复处理`);
      return order;
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        `订单状态为 ${order.status}，无法履约`,
      );
    }

    // 事务执行履约
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. 更新订单状态
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          payTradeNo,
          paidAt: new Date(),
        },
      });

      // 2. 处理每个订单项
      for (const item of order.items) {
        // 计算订阅结束时间
        const now = new Date();
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + item.periodMonths);

        // upsert Subscription（因为 unique constraint，必须用 upsert 而非 create）
        const subscription = await tx.subscription.upsert({
          where: {
            enterpriseId_employeeId: {
              enterpriseId: order.enterpriseId,
              employeeId: item.employeeId,
            },
          },
          update: {
            status: 'ACTIVE',
            endDate,
            updatedAt: new Date(),
          },
          create: {
            enterpriseId: order.enterpriseId,
            employeeId: item.employeeId,
            status: 'ACTIVE',
            startDate: now,
            endDate,
          },
        });

        // 创建员工实例（按 quantity）
        const instances = [];
        for (let i = 0; i < item.quantity; i++) {
          const instance = await tx.employeeInstance.create({
            data: {
              enterpriseId: order.enterpriseId,
              templateId: item.employeeId,
              templateVersion: '1.0.0', // TODO: 从 DigitalEmployee 读取实际版本
              name: `${item.employeeName}`,
            },
          });
          instances.push(instance);
        }

        this.logger.log(
          `订阅 ${subscription.id} 已生效，创建 ${instances.length} 个实例`,
        );

        // 充值算力（如果有赠送）
        if (item.includedComputeCNY.gt(0)) {
          const computeAccount = await tx.computeAccount.findUnique({
            where: { enterpriseId: order.enterpriseId },
          });

          if (!computeAccount) {
            throw new Error(
              `企业 ${order.enterpriseId} 的算力账户不存在`,
            );
          }

          const newBalance = computeAccount.balance + item.includedComputeCNY.toNumber();

          await tx.computeTransaction.create({
            data: {
              accountId: computeAccount.id,
              type: 'RECHARGE',
              amount: item.includedComputeCNY.toNumber(),
              description: `订单 ${order.orderNo} 赠送算力`,
              metadata: { orderId: order.id, orderItemId: item.id },
            },
          });

          await tx.computeAccount.update({
            where: { id: computeAccount.id },
            data: {
              balance: newBalance,
            },
          });

          this.logger.log(
            `算力账户 ${computeAccount.id} 已充值 ${item.includedComputeCNY} 元`,
          );
        }
      }

      // 3. 清空购物车
      const deletedCart = await tx.cartItem.deleteMany({
        where: { enterpriseId: order.enterpriseId },
      });

      this.logger.log(
        `购物车已清空，删除 ${deletedCart.count} 项`,
      );

      return updatedOrder;
    });

    this.logger.log(
      `订单 ${order.orderNo} 履约完成，企业 ${order.enterpriseId}`,
    );

    return result;
  }

  /**
   * 关闭订单（超时/取消）
   */
  async close(orderId: string, reason: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException(
        `订单状态为 ${order.status}，无法关闭`,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });
  }

  /**
   * 生成订单号：yyyyMMddHHmmss + 6位随机数
   */
  private generateOrderNo(): string {
    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const random = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, '0');
    return `${dateStr}${random}`;
  }
}

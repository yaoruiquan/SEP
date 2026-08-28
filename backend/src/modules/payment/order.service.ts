import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

type FulfillmentOrder = Prisma.OrderGetPayload<{
  include: { items: { include: { employee: true } } };
}>;

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 从购物车创建订单
   * @param itemIds 可选，仅为指定的购物车项创建订单
   */
  async createFromCart(
    enterpriseId: string,
    createdBy: string,
    itemIds?: string[],
  ) {
    // 1. 获取购物车内容
    const where: any = { enterpriseId };
    if (itemIds && itemIds.length > 0) {
      where.id = { in: itemIds };
    }

    const cartItems = await this.prisma.cartItem.findMany({
      where,
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
      throw new BadRequestException("购物车为空，无法创建订单");
    }

    // 2. 校验所有员工都是已审核状态
    const unapprovedEmployees = cartItems.filter(
      (item) => item.employee.status !== "APPROVED",
    );
    if (unapprovedEmployees.length > 0) {
      throw new BadRequestException(
        `购物车中存在未审核员工: ${unapprovedEmployees.map((i) => i.employee.name).join(", ")}`,
      );
    }

    // 3. 生成订单号（格式：yyyyMMddHHmmss + 6位随机数）
    const orderNo = this.generateOrderNo();

    // 4. 计算总金额
    let totalAmount = new Decimal(0);
    const orderItems = cartItems.map((cartItem) => {
      const unitPrice = cartItem.employee.annualPriceCNY || new Decimal(0);
      const periodFactor = new Decimal(cartItem.periodMonths).div(12);
      const subtotal = unitPrice.mul(periodFactor);
      totalAmount = totalAmount.add(subtotal);

      return {
        employeeId: cartItem.employeeId,
        employeeName: cartItem.employee.name,
        unitPrice,
        periodMonths: cartItem.periodMonths,
        quantity: 1,
        includedComputeCNY: cartItem.employee.includedComputeCNY,
      };
    });

    // 5. 创建订单
    const order = await this.prisma.order.create({
      data: {
        orderNo,
        enterpriseId,
        createdBy,
        status: "PENDING",
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

  /** 从员工市场直接创建订阅订单，不创建购物车项。 */
  async createDirect(
    enterpriseId: string,
    createdBy: string,
    input: { employeeId: string; periodMonths: number },
  ) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: input.employeeId },
      select: {
        id: true,
        name: true,
        avatar: true,
        description: true,
        annualPriceCNY: true,
        includedComputeCNY: true,
        status: true,
      },
    });

    if (!employee) throw new NotFoundException("员工不存在");
    if (employee.status !== "APPROVED") {
      throw new BadRequestException("该数字员工尚未审核通过，无法订阅");
    }

    const existingSubscription = await this.prisma.subscription.findUnique({
      where: {
        enterpriseId_employeeId: {
          enterpriseId,
          employeeId: input.employeeId,
        },
      },
      select: { status: true },
    });
    if (existingSubscription?.status === "ACTIVE") {
      throw new BadRequestException("已订阅该硅基员工，无法重复下单");
    }

    const unitPrice = employee.annualPriceCNY ?? new Decimal(0);
    if (unitPrice.lessThanOrEqualTo(0)) {
      throw new BadRequestException("员工未设置有效价格，无法订阅");
    }
    const totalAmount = unitPrice.mul(new Decimal(input.periodMonths).div(12));
    const orderNo = this.generateOrderNo();

    return this.prisma.order.create({
      data: {
        orderNo,
        enterpriseId,
        createdBy,
        status: "PENDING",
        totalAmount,
        items: {
          create: [
            {
              employeeId: employee.id,
              employeeName: employee.name,
              unitPrice,
              periodMonths: input.periodMonths,
              quantity: 1,
              includedComputeCNY: employee.includedComputeCNY,
            },
          ],
        },
      },
      include: {
        items: {
          include: {
            employee: {
              select: { id: true, name: true, avatar: true, description: true },
            },
          },
        },
      },
    });
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
        orderBy: { createdAt: "desc" },
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
      throw new NotFoundException("订单不存在");
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
  async fulfill(
    orderId: string,
    payTradeNo: string,
    payChannel: "ALIPAY" | "BALANCE" = "ALIPAY",
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { employee: true } } },
    });

    if (!order) {
      throw new NotFoundException("订单不存在");
    }

    if (order.status === "PAID") {
      this.logger.warn(`订单 ${order.orderNo} 已履约，跳过重复处理`);
      return order;
    }

    if (order.status !== "PENDING") {
      throw new BadRequestException(`订单状态为 ${order.status}，无法履约`);
    }

    const result = await this.prisma.$transaction((tx) =>
      this.executeFulfillment(tx, order, payTradeNo, payChannel),
    );

    this.logger.log(
      `订单 ${order.orderNo} 履约完成，企业 ${order.enterpriseId}`,
    );

    return result;
  }

  /** 在调用方事务内履约，供余额扣款与订单生效保持原子性。 */
  async fulfillInTransaction(
    tx: Prisma.TransactionClient,
    orderId: string,
    payTradeNo: string,
    payChannel: "ALIPAY" | "BALANCE" = "ALIPAY",
  ) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { employee: true } } },
    });

    if (!order) {
      throw new NotFoundException("订单不存在");
    }
    if (order.status === "PAID") {
      this.logger.warn(`订单 ${order.orderNo} 已履约，跳过重复处理`);
      return order;
    }
    if (order.status !== "PENDING") {
      throw new BadRequestException(`订单状态为 ${order.status}，无法履约`);
    }

    return this.executeFulfillment(tx, order, payTradeNo, payChannel);
  }

  private async executeFulfillment(
    tx: Prisma.TransactionClient,
    order: FulfillmentOrder,
    payTradeNo: string,
    payChannel: "ALIPAY" | "BALANCE",
  ) {
    // 市场订单只能由企业管理员创建。支付履约后，管理员应立即拥有
    // 这批硅基员工；其他成员仍须通过独立的授权记录获得使用权限。
    const purchaser = await tx.enterpriseMember.findUnique({
      where: {
        userId_enterpriseId: {
          userId: order.createdBy,
          enterpriseId: order.enterpriseId,
        },
      },
      select: { id: true, role: true },
    });
    if (!purchaser || purchaser.role !== "ENTERPRISE_ADMIN") {
      throw new BadRequestException("订单创建人不是该企业管理员，无法履约");
    }

    // 1. 更新订单状态
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        payTradeNo,
        payChannel,
        paidAt: new Date(),
      },
    });

    // 2. 处理每个订单项
    for (const item of order.items) {
      // 计算订阅结束时间
      const now = new Date();
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + item.periodMonths);

      // 锁定履约时刻的模板版本。不能写死版本号 —— templateVersion 是
      // 「提示式升级」的基准，写错会让模板发新版后永远提示可升级。
      const employee = await tx.digitalEmployee.findUnique({
        where: { id: item.employeeId },
        select: { version: true },
      });
      if (!employee) {
        throw new NotFoundException(
          `订单项对应的员工 ${item.employeeId} 不存在`,
        );
      }

      // upsert Subscription（因为 unique constraint，必须用 upsert 而非 create）
      const subscription = await tx.subscription.upsert({
        where: {
          enterpriseId_employeeId: {
            enterpriseId: order.enterpriseId,
            employeeId: item.employeeId,
          },
        },
        update: {
          status: "ACTIVE",
          endDate,
          updatedAt: new Date(),
        },
        create: {
          enterpriseId: order.enterpriseId,
          employeeId: item.employeeId,
          status: "ACTIVE",
          startDate: now,
          endDate,
          templateVersion: employee.version,
          name: item.employeeName,
        },
      });

      this.logger.log(`订阅 ${subscription.id} 已激活`);

      // 管理员订阅后默认授权给自己。使用查后更新/创建而不是 upsert，
      // 因为 EmployeeGrant 的唯一性由两个部分索引表达，Prisma 无法建模。
      const existingAdminGrant = await tx.employeeGrant.findFirst({
        where: {
          subscriptionId: subscription.id,
          memberId: purchaser.id,
        },
        select: { id: true },
      });
      if (existingAdminGrant) {
        await tx.employeeGrant.update({
          where: { id: existingAdminGrant.id },
          data: { expiresAt: subscription.endDate ?? null },
        });
      } else {
        await tx.employeeGrant.create({
          data: {
            subscriptionId: subscription.id,
            memberId: purchaser.id,
            expiresAt: subscription.endDate ?? null,
          },
        });
      }

      // 充值算力（如果有赠送）
      if (item.includedComputeCNY.gt(0)) {
        const computeAccount = await tx.computeAccount.findUnique({
          where: { enterpriseId: order.enterpriseId },
        });

        if (!computeAccount) {
          throw new Error(`企业 ${order.enterpriseId} 的算力账户不存在`);
        }

        const newBalance =
          computeAccount.balance + item.includedComputeCNY.toNumber();

        await tx.computeTransaction.create({
          data: {
            accountId: computeAccount.id,
            type: "RECHARGE",
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

    // 3. 仅清理本订单对应员工的购物车项，避免直接订阅误清空其他商品
    const deletedCart = await tx.cartItem.deleteMany({
      where: {
        enterpriseId: order.enterpriseId,
        employeeId: { in: order.items.map((item) => item.employeeId) },
      },
    });

    this.logger.log(`购物车已清空，删除 ${deletedCart.count} 项`);

    return updatedOrder;
  }

  /**
   * 关闭订单（超时/取消）
   */
  async close(orderId: string, reason: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException("订单不存在");
    }

    if (order.status !== "PENDING") {
      throw new BadRequestException(`订单状态为 ${order.status}，无法关闭`);
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: "CLOSED",
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
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    const random = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    return `${dateStr}${random}`;
  }
}

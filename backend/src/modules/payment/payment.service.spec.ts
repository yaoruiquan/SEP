import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { PaymentService } from "./payment.service";

describe("PaymentService", () => {
  let service: PaymentService;
  let prisma: any;
  let orderService: any;
  let walletService: any;

  beforeEach(() => {
    prisma = {
      order: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback) => callback(prisma)),
    };
    orderService = {
      fulfillInTransaction: jest.fn().mockResolvedValue({
        id: "order-1",
        status: "PAID",
      }),
    };
    walletService = { consume: jest.fn().mockResolvedValue({ id: "tx-1" }) };

    service = new PaymentService(
      prisma,
      {} as any,
      orderService,
      {} as any,
      {} as any,
      walletService,
    );
  });

  describe("payOrderWithBalance", () => {
    it("应在同一事务内完成余额扣款和订单履约", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        orderNo: "ORD202608200001",
        enterpriseId: "ent-1",
        status: "PENDING",
        totalAmount: new Decimal(5000),
      });

      const result = await service.payOrderWithBalance("order-1", "ent-1");

      expect(walletService.consume).toHaveBeenCalledWith(
        "ent-1",
        5000,
        "subscription",
        "order-1",
        "余额支付订单 ORD202608200001",
        prisma,
      );
      expect(orderService.fulfillInTransaction).toHaveBeenCalledWith(
        prisma,
        "order-1",
        "BALANCE:ORD202608200001",
        "BALANCE",
      );
      expect(result.status).toBe("PAID");
    });

    it("跨企业订单应返回不存在且不扣款", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        enterpriseId: "ent-other",
        status: "PENDING",
      });

      await expect(
        service.payOrderWithBalance("order-1", "ent-1"),
      ).rejects.toThrow(NotFoundException);
      expect(walletService.consume).not.toHaveBeenCalled();
    });

    it("非待支付订单应拒绝重复扣款", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: "order-1",
        enterpriseId: "ent-1",
        status: "PAID",
      });

      await expect(
        service.payOrderWithBalance("order-1", "ent-1"),
      ).rejects.toThrow(BadRequestException);
      expect(walletService.consume).not.toHaveBeenCalled();
    });
  });
});

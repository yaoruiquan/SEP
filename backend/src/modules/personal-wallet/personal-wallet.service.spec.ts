/**
 * 个人钱包 —— 扣费链的**最后一腿**。
 *
 * 这里锁的都是「写错了就会在正常业务里炸掉、或者悄悄吞钱」的路径：
 *   1. 没有钱包不是错误，只是这一腿付不了钱 —— 抛异常会把「额度用尽且没自付」
 *      这个完全正常的场景变成 500
 *   2. 余额永不为负：不够就扣到 0，差额作为 unpaid 交回调用方如实记账
 *   3. 对话前的闸门每轮都要问余额，那条路径上**不许写库**（不给人凭空发钱包）
 *   4. 乐观锁没命中要抛冲突让整笔重试，绝不静默少扣
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PersonalWalletService } from './personal-wallet.service';

const d = (n: number | string) => new Decimal(n);

describe('PersonalWalletService', () => {
  let prisma: any;
  let svc: PersonalWalletService;
  let createdTx: any;

  /** 钱包行。设为 null 表示「这个人从没充过钱」。 */
  let walletRow: any;
  /** 充值订单行。设为 null 表示「查不到这张订单」。 */
  let orderRow: any;
  let createdOrder: any;

  /** 一张待支付的 ¥30 订单，履约用例的共同起点。 */
  const pendingOrder = () => ({
    id: 'pro-1',
    orderNo: 'PRC-1',
    userId: 'user-1',
    amount: d(30),
    status: 'PENDING',
    payChannel: null,
    payTradeNo: null,
    paidAt: null,
  });

  beforeEach(() => {
    createdTx = null;
    createdOrder = null;
    orderRow = null;
    walletRow = {
      id: 'pw-1',
      userId: 'user-1',
      balance: d(20),
      totalDepositCNY: d(50),
      totalConsumeCNY: d(30),
      version: 3,
    };

    // 有状态的钱包 mock：写回落到 walletRow 上，断言才能看出「充完值余额真的变了」
    prisma = {
      personalWallet: {
        findUnique: jest.fn(() => Promise.resolve(walletRow)),
        create: jest.fn((a: any) => {
          walletRow = {
            id: 'pw-new',
            userId: a.data.userId,
            balance: d(0),
            totalDepositCNY: d(0),
            totalConsumeCNY: d(0),
            version: 0,
          };
          return Promise.resolve(walletRow);
        }),
        // 履约在事务里用 upsert 取钱包：version 必须是本事务看到的值
        upsert: jest.fn((a: any) => {
          if (!walletRow) {
            walletRow = {
              id: 'pw-new',
              userId: a.where.userId,
              balance: d(0),
              totalDepositCNY: d(0),
              totalConsumeCNY: d(0),
              version: 0,
            };
          }
          return Promise.resolve(walletRow);
        }),
        updateMany: jest.fn((a: any) => {
          // 乐观锁：版本不匹配则 0 行受影响
          if (!walletRow || a.where.version !== walletRow.version) {
            return Promise.resolve({ count: 0 });
          }
          if (a.data.balance !== undefined) walletRow.balance = a.data.balance;
          if (a.data.totalDepositCNY?.increment) {
            walletRow.totalDepositCNY = walletRow.totalDepositCNY.add(
              a.data.totalDepositCNY.increment,
            );
          }
          if (a.data.totalConsumeCNY?.increment) {
            walletRow.totalConsumeCNY = walletRow.totalConsumeCNY.add(
              a.data.totalConsumeCNY.increment,
            );
          }
          walletRow.version += 1;
          return Promise.resolve({ count: 1 });
        }),
      },
      personalWalletTransaction: {
        create: jest.fn((a: any) => {
          createdTx = a.data;
          return Promise.resolve({ id: 'ptx-1', ...a.data });
        }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      personalRechargeOrder: {
        create: jest.fn((a: any) => {
          createdOrder = { id: 'pro-1', ...a.data };
          return Promise.resolve(createdOrder);
        }),
        findUnique: jest.fn(() => Promise.resolve(orderRow)),
        findFirst: jest.fn(() => Promise.resolve(orderRow)),
        updateMany: jest.fn((a: any) => {
          if (!orderRow || orderRow.status !== a.where.status) {
            return Promise.resolve({ count: 0 });
          }
          orderRow = { ...orderRow, ...a.data };
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    prisma.$transaction = jest.fn((cb: any) => cb(prisma));

    svc = new PersonalWalletService(prisma);
  });

  describe('getBalance —— 对话前闸门每轮都要问', () => {
    it('❗只读，不创建钱包 —— 否则每个成员都会拿到一个他没申请过的钱包', async () => {
      walletRow = null;

      await expect(svc.getBalance('user-1')).resolves.toEqual(d(0));
      expect(prisma.personalWallet.create).not.toHaveBeenCalled();
    });

    it('有钱包时返回余额', async () => {
      await expect(svc.getBalance('user-1')).resolves.toEqual(d(20));
    });

    it('余额异常为负时对外显示 0，不把脏数据当可用额', async () => {
      walletRow = { balance: d(-5) };

      const balance = await svc.getBalance('user-1');
      expect(balance.isZero()).toBe(true);
    });
  });

  describe('getView —— 面板上的三个数字', () => {
    /**
     * ❗这条锁的是「同一个页面上两个自相矛盾的数字」：
     * 自费一轮常花不到 1 分，如果余额/已消费都四舍五入到分，面板会写
     * 「已消费 ¥0.00」，而下面的流水里明明有一笔 -¥0.0025。
     * 谁想把 subCent 简化成 toFixed(2)，这条会先红。
     */
    it('1 分以下的余额与已消费保留 4 位小数', async () => {
      walletRow.balance = d('0.0075');
      walletRow.totalConsumeCNY = d('0.0025');

      const view = await svc.getView('user-1');

      expect(view.balanceCNY).toBe('0.0075');
      expect(view.totalConsumeCNY).toBe('0.0025');
    });

    it('1 分以上仍是两位小数 —— 不给正常金额加没用的尾数', async () => {
      walletRow.balance = d('19.9975');

      const view = await svc.getView('user-1');

      expect(view.balanceCNY).toBe('20.00');
      // 充值是人手填的整数分，永远两位
      expect(view.totalDepositCNY).toBe('50.00');
      expect(view.totalConsumeCNY).toBe('30.00');
    });

    it('没有钱包时建一个空的 —— 面板要能显示 ¥0.00，不能 404', async () => {
      walletRow = null;

      const view = await svc.getView('user-2');

      expect(prisma.personalWallet.create).toHaveBeenCalled();
      expect(view).toEqual({
        balanceCNY: '0.00',
        totalDepositCNY: '0.00',
        totalConsumeCNY: '0.00',
      });
    });
  });

  describe('consumeUpTo —— 扣「最多 amount」', () => {
    const meta = { relatedId: 'sess-1', description: '对话算力消费' };

    it('金额为 0 或负时直接返回，连库都不查', async () => {
      const result = await svc.consumeUpTo(prisma, 'user-1', d(0), meta);

      expect(result).toEqual({
        transactionId: null,
        paid: d(0),
        unpaid: d(0),
      });
      expect(prisma.personalWallet.findUnique).not.toHaveBeenCalled();
    });

    it('❗没有钱包不抛异常，只是这一腿付不了钱', async () => {
      walletRow = null;

      const result = await svc.consumeUpTo(prisma, 'user-1', d(3), meta);

      // 抛异常会让「公司额度用尽且成员没自付」这个正常场景变成 500
      expect(result.paid.isZero()).toBe(true);
      expect(result.unpaid.toFixed(2)).toBe('3.00');
      expect(result.transactionId).toBeNull();
      expect(prisma.personalWallet.updateMany).not.toHaveBeenCalled();
    });

    it('余额充足时全额扣，流水记为负数出账', async () => {
      const result = await svc.consumeUpTo(prisma, 'user-1', d(8), meta);

      expect(result.paid.toFixed(2)).toBe('8.00');
      expect(result.unpaid.isZero()).toBe(true);
      expect(result.transactionId).toBe('ptx-1');

      const { data } = prisma.personalWallet.updateMany.mock.calls[0][0];
      expect(data.balance.toFixed(2)).toBe('12.00');
      expect(data.totalConsumeCNY.increment.toFixed(2)).toBe('8.00');
      expect(data.version).toEqual({ increment: 1 });

      expect(createdTx.type).toBe('CONSUME');
      expect(createdTx.amount.toFixed(2)).toBe('-8.00');
      expect(createdTx.balanceBefore.toFixed(2)).toBe('20.00');
      expect(createdTx.balanceAfter.toFixed(2)).toBe('12.00');
      // 流水要能溯源到那次对话，否则成员看到一笔扣款无从对账
      expect(createdTx.relatedType).toBe('compute');
      expect(createdTx.relatedId).toBe('sess-1');
    });

    it('❗余额不足时扣到 0，差额作为 unpaid 交回，余额绝不变负', async () => {
      walletRow.balance = d(3);

      const result = await svc.consumeUpTo(prisma, 'user-1', d(10), meta);

      expect(result.paid.toFixed(2)).toBe('3.00');
      expect(result.unpaid.toFixed(2)).toBe('7.00');
      const { data } = prisma.personalWallet.updateMany.mock.calls[0][0];
      expect(data.balance.isZero()).toBe(true);
    });

    it('余额为 0 的钱包等同于没有钱包，不写空流水', async () => {
      walletRow.balance = d(0);

      const result = await svc.consumeUpTo(prisma, 'user-1', d(10), meta);

      expect(result.paid.isZero()).toBe(true);
      expect(result.unpaid.toFixed(2)).toBe('10.00');
      expect(prisma.personalWallet.updateMany).not.toHaveBeenCalled();
      expect(prisma.personalWalletTransaction.create).not.toHaveBeenCalled();
    });

    it('❗乐观锁没命中就抛冲突 —— 让整笔扣费重试，账单幂等键保证不会重复入账', async () => {
      prisma.personalWallet.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        svc.consumeUpTo(prisma, 'user-1', d(5), meta),
      ).rejects.toThrow(ConflictException);
      expect(prisma.personalWalletTransaction.create).not.toHaveBeenCalled();
    });

    it('乐观锁比对的是读到的那个版本号', async () => {
      await svc.consumeUpTo(prisma, 'user-1', d(5), meta);

      const { where } = prisma.personalWallet.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: 'pw-1', version: 3 });
    });

    it('金额按账本精度 6 位入账，不让 Prisma 层静默截断', async () => {
      walletRow.balance = d(1);

      const result = await svc.consumeUpTo(
        prisma,
        'user-1',
        d('0.1234567'),
        meta,
      );

      expect(result.paid.toFixed(7)).toBe('0.1234570');
    });
  });

  /**
   * 充值 —— 唯一的入账路径。
   *
   * 这一组锁的是「白送钱」和「重复送钱」两类事故：
   *   · 下单**不加余额**（下单就入账 = 每个成员一台印钞机）
   *   · 履约幂等：支付宝会重推通知，对账任务也可能与通知撞车
   *   · 订单翻 PAID 与钱包入账必须同一个事务（否则出现「已付款、没余额」的黑洞）
   */
  describe('createRechargeOrder —— 只下单，不加钱', () => {
    it('❗下单不动余额、不写流水 —— 这条红了就是印钞机回来了', async () => {
      await svc.createRechargeOrder('user-1', 30);

      expect(prisma.personalWallet.updateMany).not.toHaveBeenCalled();
      expect(prisma.personalWalletTransaction.create).not.toHaveBeenCalled();
      expect(createdOrder.status).toBe('PENDING');
    });

    it('订单号以 PRC 开头 —— 支付回调靠前缀分流到个人履约链', async () => {
      await svc.createRechargeOrder('user-1', 30);

      expect(createdOrder.orderNo).toMatch(/^PRC\d{20}$/);
      expect(createdOrder.userId).toBe('user-1');
      expect(createdOrder.amount.toFixed(2)).toBe('30.00');
    });

    it('金额必须大于 0', async () => {
      await expect(svc.createRechargeOrder('user-1', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(svc.createRechargeOrder('user-1', -1)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        svc.createRechargeOrder('user-1', Number.NaN),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.personalRechargeOrder.create).not.toHaveBeenCalled();
    });

    it('金额截到分 —— 订单金额与支付渠道实收必须一致', async () => {
      await svc.createRechargeOrder('user-1', 10.009);
      expect(createdOrder.amount.toFixed(2)).toBe('10.00');
    });

    it('不足 1 分的充值直接拒掉，不生成一张 ¥0.00 的订单', async () => {
      await expect(svc.createRechargeOrder('user-1', 0.004)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('先确保钱包存在 —— 履约时钱包缺失会让一笔已收的钱无处入账', async () => {
      walletRow = null;
      await svc.createRechargeOrder('user-1', 10);
      expect(prisma.personalWallet.create).toHaveBeenCalled();
    });
  });

  describe('getRechargeOrder —— 作用域', () => {
    it('❗userId 写进 where：别人的订单号问不出「它存在」', async () => {
      orderRow = null;

      await expect(svc.getRechargeOrder('user-1', 'PRC1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.personalRechargeOrder.findFirst).toHaveBeenCalledWith({
        where: { orderNo: 'PRC1', userId: 'user-1' },
      });
    });
  });

  describe('fulfillRechargeOrder —— 履约幂等', () => {
    it('加余额、累计充值额与一条 DEPOSIT 流水，订单翻 PAID', async () => {
      orderRow = pendingOrder();

      await svc.fulfillRechargeOrder('PRC-1', 'alipay-tx-1', 'ALIPAY');

      const { data } = prisma.personalWallet.updateMany.mock.calls[0][0];
      expect(data.balance.toFixed(2)).toBe('50.00');
      expect(data.totalDepositCNY.increment.toFixed(2)).toBe('30.00');

      expect(createdTx.type).toBe('DEPOSIT');
      expect(createdTx.amount.toFixed(2)).toBe('30.00');
      expect(createdTx.balanceBefore.toFixed(2)).toBe('20.00');
      expect(createdTx.balanceAfter.toFixed(2)).toBe('50.00');
      // 流水指回订单，日后对账能顺着 relatedId 找到那笔支付
      expect(createdTx.relatedType).toBe('recharge_order');
      expect(createdTx.relatedId).toBe('pro-1');

      expect(orderRow.status).toBe('PAID');
      expect(orderRow.payTradeNo).toBe('alipay-tx-1');
      expect(orderRow.payChannel).toBe('ALIPAY');
    });

    it('❗已 PAID 的订单直接返回 —— 支付宝重推通知不会重复入账', async () => {
      orderRow = { ...pendingOrder(), status: 'PAID' };

      await svc.fulfillRechargeOrder('PRC-1', 'alipay-tx-1', 'ALIPAY');

      expect(prisma.personalWallet.updateMany).not.toHaveBeenCalled();
      expect(prisma.personalWalletTransaction.create).not.toHaveBeenCalled();
    });

    it('❗状态翻转拿到 0 行也不入账 —— 与对账任务撞车时的那一路', async () => {
      orderRow = pendingOrder();
      prisma.personalRechargeOrder.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await svc.fulfillRechargeOrder('PRC-1', 'alipay-tx-1', 'ALIPAY');

      expect(prisma.personalWallet.updateMany).not.toHaveBeenCalled();
      expect(prisma.personalWalletTransaction.create).not.toHaveBeenCalled();
    });

    it('已关闭的订单不入账 —— 钱真收到了要走人工退款，不能默默加余额', async () => {
      orderRow = { ...pendingOrder(), status: 'CLOSED' };

      await expect(
        svc.fulfillRechargeOrder('PRC-1', 'tx', 'ALIPAY'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.personalWallet.updateMany).not.toHaveBeenCalled();
    });

    it('订单不存在时 404，而不是凭空建一个', async () => {
      orderRow = null;
      await expect(
        svc.fulfillRechargeOrder('PRC-nope', 'tx', 'ALIPAY'),
      ).rejects.toThrow(NotFoundException);
    });

    it('❗订单翻转与入账在同一个事务里 —— 否则会有「已付款、没余额」的黑洞', async () => {
      orderRow = pendingOrder();

      await svc.fulfillRechargeOrder('PRC-1', 'tx', 'ALIPAY');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // 翻转与入账都在事务客户端上发生
      expect(prisma.personalRechargeOrder.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.personalWalletTransaction.create).toHaveBeenCalledTimes(1);
    });

    it('乐观锁没命中就抛冲突，让整笔事务回滚回 PENDING 等重试', async () => {
      orderRow = pendingOrder();
      prisma.personalWallet.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        svc.fulfillRechargeOrder('PRC-1', 'tx', 'ALIPAY'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.personalWalletTransaction.create).not.toHaveBeenCalled();
    });

    it('钱包不存在时就地建出来 —— 已收的钱必须有地方落', async () => {
      orderRow = pendingOrder();
      walletRow = null;

      await svc.fulfillRechargeOrder('PRC-1', 'tx', 'ALIPAY');

      expect(createdTx.type).toBe('DEPOSIT');
      expect(createdTx.balanceAfter.toFixed(2)).toBe('30.00');
    });
  });

  describe('listTransactions', () => {
    it('没有钱包时返回空页，不是 500', async () => {
      walletRow = null;

      const page = await svc.listTransactions('user-1');

      expect(page).toEqual({
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        records: [],
      });
      expect(prisma.personalWalletTransaction.findMany).not.toHaveBeenCalled();
    });

    it('分页参数被夹在合理区间内 —— 不让 pageSize=99999 拖垮库', async () => {
      await svc.listTransactions('user-1', { page: 0, pageSize: 99_999 });

      const { skip, take } = prisma.personalWalletTransaction.findMany.mock.calls[0][0];
      expect(skip).toBe(0);
      expect(take).toBe(100);
    });

    it('❗金额保留 4 位小数 —— 两位会把一整页对话流水显示成 ¥0.00', async () => {
      prisma.personalWalletTransaction.count.mockResolvedValue(1);
      prisma.personalWalletTransaction.findMany.mockResolvedValue([
        {
          id: 'ptx-9',
          type: 'CONSUME',
          amount: d('-0.0032'),
          balanceAfter: d('19.9968'),
          description: '对话算力消费',
          relatedType: 'compute',
          relatedId: 'sess-1',
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      ]);

      const page = await svc.listTransactions('user-1');

      expect(page.records[0].amountCNY).toBe('-0.0032');
      expect(page.records[0].balanceAfterCNY).toBe('19.9968');
      expect(page.total).toBe(1);
    });
  });
});

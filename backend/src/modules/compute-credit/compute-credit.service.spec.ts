/**
 * 统一人民币算力账本的扣费行为。
 *
 * 这里覆盖的都是「测试全绿也可能亏钱」的路径：赠送余额与钱包的扣减顺序、
 * 余额不足时不许变负、流式重试不许重复扣费、并发冲突要抛错而不是静默丢账。
 */
import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ComputeCreditService } from './compute-credit.service';
import { SETTING_KEYS } from 'shared';

const ENTERPRISE = 'ent-acme';
const SUBSCRIPTION = 'sub-1';

/** 固定 1 元/1K 输入、0 输出的保底价，让每个用例的成本都是好算的整数。 */
const FLAT_PRICE_SETTINGS: Record<string, string> = {
  [SETTING_KEYS.USD_TO_CNY_RATE]: '7.2',
  [SETTING_KEYS.FALLBACK_PRICE_INPUT]: '1',
  [SETTING_KEYS.FALLBACK_PRICE_OUTPUT]: '0',
};

interface CreditRow {
  id: string;
  subscriptionId: string;
  enterpriseId: string;
  grantedCNY: Decimal;
  usedCNY: Decimal;
  status: string;
  version: number;
}

function makeCredit(overrides: Partial<CreditRow> = {}): CreditRow {
  return {
    id: 'credit-1',
    subscriptionId: SUBSCRIPTION,
    enterpriseId: ENTERPRISE,
    grantedCNY: new Decimal(0),
    usedCNY: new Decimal(0),
    status: 'ACTIVE',
    version: 0,
    ...overrides,
  };
}

describe('ComputeCreditService.chargeUsage', () => {
  let prisma: any;
  let wallet: any;
  let settings: any;
  let svc: ComputeCreditService;
  let createdRecord: any;

  /** 钱包余额（元）。用例改这个值来构造「够 / 不够 / 完全没钱」。 */
  let walletBalance: Decimal;
  let creditRow: CreditRow | null;

  beforeEach(() => {
    walletBalance = new Decimal(100);
    creditRow = null;
    createdRecord = null;

    prisma = {
      computeUsageRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn((a: any) => {
          createdRecord = a.data;
          return Promise.resolve({ id: 'usage-1', ...a.data });
        }),
        aggregate: jest.fn(),
      },
      subscriptionCredit: {
        findUnique: jest.fn(() => Promise.resolve(creditRow)),
        create: jest.fn((a: any) => Promise.resolve({ id: 'credit-1', ...a.data })),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
        updateMany: jest.fn((a: any) => {
          // 模拟乐观锁：版本不匹配则 0 行受影响
          if (creditRow && a.where.version !== creditRow.version) {
            return Promise.resolve({ count: 0 });
          }
          if (creditRow) {
            creditRow.usedCNY = a.data.usedCNY;
            creditRow.status = a.data.status;
            creditRow.version += 1;
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    wallet = {
      ensureWalletExists: jest.fn(() =>
        Promise.resolve({ id: 'wallet-1', balance: walletBalance }),
      ),
      // 真实实现的语义：有多少扣多少，差额作为 unpaid 返回，余额不变负
      consumeComputeUpTo: jest.fn(
        async (_client: unknown, _entId: string, amount: Decimal) => {
          const paid = Decimal.min(walletBalance, amount);
          const unpaid = amount.sub(paid);
          walletBalance = walletBalance.sub(paid);
          return {
            transactionId: paid.greaterThan(0) ? 'wtx-1' : null,
            paid,
            unpaid,
          };
        },
      ),
    };

    settings = {
      getEffectiveValue: jest.fn((key: string) => FLAT_PRICE_SETTINGS[key]),
    };

    // 额度闸门在这两组测试里一律放行 —— 它们锁的是扣费与发放，不是分配规则
    const allowance = { check: jest.fn().mockResolvedValue({ allowed: true }) } as never;
    svc = new ComputeCreditService(prisma, wallet, settings, allowance);
  });

  const charge = (overrides: Record<string, unknown> = {}) =>
    svc.chargeUsage({
      enterpriseId: ENTERPRISE,
      subscriptionId: SUBSCRIPTION,
      employeeId: 'emp-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      messageId: 'msg-1',
      modelId: 'unknown-model',
      inputTokens: 10_000, // × ¥1 / 1K = ¥10
      outputTokens: 0,
      ...overrides,
    } as any);

  it('赠送余额充足时全额从赠送扣，不动钱包', async () => {
    creditRow = makeCredit({ grantedCNY: new Decimal(50) });

    const result = await charge();

    expect(result.costCNY.toNumber()).toBe(10);
    expect(result.creditPaidCNY.toNumber()).toBe(10);
    expect(result.walletPaidCNY.toNumber()).toBe(0);
    expect(walletBalance.toNumber()).toBe(100);
    expect(creditRow!.usedCNY.toNumber()).toBe(10);
    expect(creditRow!.status).toBe('ACTIVE');
  });

  it('❗赠送余额不足时先扣光赠送，差额才扣钱包', async () => {
    creditRow = makeCredit({ grantedCNY: new Decimal(4) });

    const result = await charge();

    expect(result.creditPaidCNY.toNumber()).toBe(4);
    expect(result.walletPaidCNY.toNumber()).toBe(6);
    expect(result.unpaidCNY.toNumber()).toBe(0);
    expect(walletBalance.toNumber()).toBe(94);
    // 赠送用尽后要标记 EXHAUSTED，否则下次还会尝试从这里扣
    expect(creditRow!.status).toBe('EXHAUSTED');
  });

  it('没有订阅赠送额度时整笔走钱包', async () => {
    creditRow = null;

    const result = await charge();

    expect(result.creditPaidCNY.toNumber()).toBe(0);
    expect(result.walletPaidCNY.toNumber()).toBe(10);
    expect(walletBalance.toNumber()).toBe(90);
  });

  it('赠送额度已停用（订阅终止）时不再扣它', async () => {
    creditRow = makeCredit({ grantedCNY: new Decimal(50), status: 'EXPIRED' });

    const result = await charge();

    expect(result.creditPaidCNY.toNumber()).toBe(0);
    expect(result.walletPaidCNY.toNumber()).toBe(10);
    // 停用的额度余额不动
    expect(creditRow!.usedCNY.toNumber()).toBe(0);
  });

  it('❗别家企业的 subscriptionId 不能花本企业的赠送额度', async () => {
    creditRow = makeCredit({
      grantedCNY: new Decimal(50),
      enterpriseId: 'ent-globex', // ← 别家
    });

    const result = await charge();

    expect(result.creditPaidCNY.toNumber()).toBe(0);
    expect(result.walletPaidCNY.toNumber()).toBe(10);
    expect(creditRow!.usedCNY.toNumber()).toBe(0);
  });

  it('❗钱包余额不足时扣到 0 并记欠费，余额绝不变负', async () => {
    creditRow = null;
    walletBalance = new Decimal(3);

    const result = await charge();

    expect(result.walletPaidCNY.toNumber()).toBe(3);
    expect(result.unpaidCNY.toNumber()).toBe(7);
    expect(walletBalance.toNumber()).toBe(0);
    // 恒等式：赠送 + 钱包 + 欠费 == 成本
    expect(
      result.creditPaidCNY.add(result.walletPaidCNY).add(result.unpaidCNY).toNumber(),
    ).toBe(result.costCNY.toNumber());
  });

  it('❗流式重试命中幂等键时不重复扣费', async () => {
    prisma.computeUsageRecord.findUnique.mockResolvedValue({
      id: 'usage-existing',
      costCNY: new Decimal(10),
      creditPaidCNY: new Decimal(10),
      walletPaidCNY: new Decimal(0),
      unpaidCNY: new Decimal(0),
      fallbackPricing: true,
    });
    creditRow = makeCredit({ grantedCNY: new Decimal(50) });

    const result = await charge();

    expect(result.alreadyCharged).toBe(true);
    expect(result.usageRecordId).toBe('usage-existing');
    expect(prisma.computeUsageRecord.create).not.toHaveBeenCalled();
    expect(wallet.consumeComputeUpTo).not.toHaveBeenCalled();
    expect(creditRow!.usedCNY.toNumber()).toBe(0);
  });

  it('幂等键由 sessionId + messageId 构成', async () => {
    creditRow = null;

    await charge({ sessionId: 'sess-9', messageId: 'msg-9' });

    expect(prisma.computeUsageRecord.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'sess-9:msg-9' },
    });
    expect(createdRecord.idempotencyKey).toBe('sess-9:msg-9');
  });

  it('❗并发扣同一笔赠送额度时抛冲突，整笔重试而不是静默少扣', async () => {
    creditRow = makeCredit({ grantedCNY: new Decimal(50) });
    // 模拟「读到 version=0，写入前别人已经改成 1」
    prisma.subscriptionCredit.updateMany.mockResolvedValue({ count: 0 });

    await expect(charge()).rejects.toThrow(ConflictException);
    expect(prisma.computeUsageRecord.create).not.toHaveBeenCalled();
  });

  it('账单落库时同时记下 Token 明细与计价参数，便于事后复核', async () => {
    creditRow = makeCredit({ grantedCNY: new Decimal(50) });

    await charge({ inputTokens: 1000, outputTokens: 500 });

    expect(createdRecord).toMatchObject({
      enterpriseId: ENTERPRISE,
      subscriptionId: SUBSCRIPTION,
      employeeId: 'emp-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      messageId: 'msg-1',
      modelId: 'unknown-model',
      inputTokens: 1000,
      outputTokens: 500,
      fallbackPricing: true,
    });
    expect(Number(createdRecord.usdToCnyRate)).toBe(7.2);
    // Token 只是明细：金额由单价算出，不是 token 数本身
    expect(Number(createdRecord.costCNY)).toBeCloseTo(1, 6);
  });

  it('成本为 0 的调用不扣任何余额，但仍留一条账单', async () => {
    creditRow = makeCredit({ grantedCNY: new Decimal(50) });

    const result = await charge({ inputTokens: 0, outputTokens: 0 });

    expect(result.costCNY.toNumber()).toBe(0);
    expect(result.creditPaidCNY.toNumber()).toBe(0);
    expect(result.walletPaidCNY.toNumber()).toBe(0);
    expect(prisma.computeUsageRecord.create).toHaveBeenCalled();
  });

  it('钱包在进入事务前就绪 —— 事务内建钱包会和乐观锁纠缠', async () => {
    creditRow = null;

    await charge();

    expect(wallet.ensureWalletExists).toHaveBeenCalledWith(ENTERPRISE);
  });
});

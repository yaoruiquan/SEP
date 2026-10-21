const { retireMarketEmployees, validatePlan, PROTECTED_MODELS } = require('./retire-market-employees.cjs');

describe('Production market retirement maintenance', () => {
  let plan: any;
  let state: any;
  let tx: any;
  let prisma: any;
  const clone = (value: any) => structuredClone(value);
  const find = (rows: any[], where: any) => rows.filter(row =>
    where?.employeeId?.in ? where.employeeId.in.includes(row.employeeId)
      : where?.employeeId?.notIn ? !where.employeeId.notIn.includes(row.employeeId)
        : where?.subscriptionId?.in ? where.subscriptionId.in.includes(row.subscriptionId) : true);

  beforeEach(() => {
    plan = { operation: 'market-retirement-2026-10-19', database: 'sep_prod',
      expectedPublished: 181, refundPolicy: 'NO_AUTOMATIC_REFUND',
      archive: Array.from({ length: 74 }, (_, index) => ({ id: `old-${index}`, name: `Old ${index}` })),
      retain: Array.from({ length: 107 }, (_, index) => ({ id: `keep-${index}`, name: `Keep ${index}` })),
    };
    state = {
      employees: [...plan.archive, ...plan.retain].map(row => ({ ...row, status: 'APPROVED', systemPrompt: 'Keep content', updatedAt: new Date(0) })),
      subscriptions: [
        { id: 'active', employeeId: 'old-0', status: 'ACTIVE', purchaseAmountCNY: 100, refundAmount: null },
        { id: 'paused', employeeId: 'old-1', status: 'PAUSED', purchaseAmountCNY: 200, refundAmount: null },
        { id: 'expired', employeeId: 'old-2', status: 'EXPIRED', purchaseAmountCNY: 300, refundAmount: 20 },
        { id: 'retained', employeeId: 'keep-0', status: 'ACTIVE', purchaseAmountCNY: 400 },
      ],
      credits: [{ id: 'credit-1', subscriptionId: 'active', status: 'ACTIVE', grantedCNY: 10, usedCNY: 1 }],
      orders: [],
    };
    tx = { $executeRawUnsafe: jest.fn(), $queryRawUnsafe: jest.fn(async () => [{ database: 'sep_prod' }]) };
    for (const model of PROTECTED_MODELS) tx[model] = { findMany: jest.fn(async () => [{ id: 'protected' }]) };
    tx.digitalEmployee = {
      findMany: jest.fn(async () => clone(state.employees)),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = state.employees.filter(row => where.id.in.includes(row.id) && row.status === where.status);
        rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      }),
    };
    tx.subscription = {
      findMany: jest.fn(async ({ where }) => clone(find(state.subscriptions, where))),
      updateMany: jest.fn(async ({ where, data }) => {
        const row = state.subscriptions.find(row => row.id === where.id && row.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      }),
    };
    tx.subscriptionCredit = {
      findMany: jest.fn(async ({ where }) => clone(find(state.credits, where))),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = state.credits.filter(row => where.id.in.includes(row.id) && row.status !== where.status.not);
        rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      }),
    };
    for (const model of ['gatewayExecution', 'mediaRealBillingReservation', 'subscriptionRequest', 'systemSetting', 'paymentNotify']) {
      tx[model] = { findMany: jest.fn(async () => []) };
    }
    tx.order = {
      findMany: jest.fn(async ({ where }) => clone(state.orders.filter(row =>
        where.id?.in ? where.id.in.includes(row.id)
          : where.id?.notIn ? !where.id.notIn.includes(row.id)
            : row.status === where.status && row.items.some(item => where.items.some.employeeId.in.includes(item.employeeId))))),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = state.orders.filter(row => where.id.in.includes(row.id) && row.status === where.status
          && row.payChannel === null && row.payTradeNo === null && row.paidAt === null);
        rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
      }),
    };
    prisma = { $transaction: jest.fn(async callback => {
      const before = clone(state);
      try { return await callback(tx); } catch (error) { state = before; throw error; }
    }) };
  });

  it('previews all scope and subscription counts without writing', async () => {
    const original = clone(state);
    const report = await retireMarketEmployees(prisma, plan);
    expect(report).toMatchObject({ archived: 74, terminated: 2, retained: 107, creditsExpired: 1 });
    expect(state).toEqual(original);
    expect(tx.digitalEmployee.updateMany).not.toHaveBeenCalled();
  });

  it('archives exactly 74, terminates active/paused only and preserves money, prompts and all 107 retained rows', async () => {
    const original = clone(state);
    const saveBefore = jest.fn();
    const result = await retireMarketEmployees(prisma, plan, { apply: true, saveBefore });
    expect(saveBefore).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ archived: 74, terminated: 2, refundsCreated: 0, remainingPublished: 107, protectedDataUnchanged: true });
    expect(state.subscriptions[0]).toMatchObject({ status: 'TERMINATED', purchaseAmountCNY: 100, refundAmount: null });
    expect(state.subscriptions[1].status).toBe('TERMINATED');
    expect(state.subscriptions.slice(2)).toEqual(original.subscriptions.slice(2));
    expect(state.credits[0]).toEqual({ ...original.credits[0], status: 'EXPIRED' });
    expect(state.employees.slice(74)).toEqual(original.employees.slice(74));
    expect(state.employees[0].systemPrompt).toBe(original.employees[0].systemPrompt);
    const repeated = await retireMarketEmployees(prisma, plan, { apply: true, saveBefore });
    expect(repeated).toMatchObject({ archived: 0, terminated: 0, creditsExpired: 0 });
  });

  it.each(['running', 'pendingOrder', 'reservation', 'pendingRequest'])('blocks %s without changing production data', async kind => {
    const original = clone(state);
    const model = { running: 'gatewayExecution', pendingOrder: 'order', reservation: 'mediaRealBillingReservation', pendingRequest: 'subscriptionRequest' }[kind];
    tx[model!].findMany.mockResolvedValue([{ id: 'blocker' }]);
    await expect(retireMarketEmployees(prisma, plan, { apply: true, saveBefore: jest.fn() })).rejects.toThrow('In-flight');
    expect(state).toEqual(original);
    expect(tx.digitalEmployee.updateMany).not.toHaveBeenCalled();
  });

  it('rejects changed identities or overlapping keep/archive scope', async () => {
    const invalid = clone(plan);
    invalid.retain[0].id = invalid.archive[0].id;
    expect(() => validatePlan(invalid)).toThrow();
    state.employees[0].name = 'Changed by operator';
    await expect(retireMarketEmployees(prisma, plan)).rejects.toThrow('Archive identity changed');
  });

  it('does not write when private backup fails and rolls back any protected-data drift', async () => {
    const original = clone(state);
    await expect(retireMarketEmployees(prisma, plan, { apply: true, saveBefore: () => { throw new Error('Disk full'); } })).rejects.toThrow('Disk full');
    expect(tx.digitalEmployee.updateMany).not.toHaveBeenCalled();
    tx.enterpriseWallet.findMany.mockResolvedValueOnce([{ id: 'before' }]).mockResolvedValueOnce([{ id: 'after' }]);
    await expect(retireMarketEmployees(prisma, plan, { apply: true, saveBefore: jest.fn() })).rejects.toThrow('Protected data changed');
    expect(state).toEqual(original);
  });

  function unpaidOrder(mixed = false) {
    state.orders = [{ id: 'unpaid', orderNo: 'order-1', status: 'PENDING', totalAmount: '100',
      payChannel: null, payTradeNo: null, paidAt: null, closedAt: null,
      items: [{ employeeId: 'old-0', unitPrice: '100' }, ...(mixed ? [{ employeeId: 'keep-0', unitPrice: '0' }] : [])] }];
    plan.closeUnpaidOrderIds = ['unpaid'];
    return { checkedAt: new Date().toISOString(), database: plan.database, gatewayHost: 'openapi.alipay.com',
      results: [{ id: 'unpaid', orderNo: 'order-1', amount: '100', mixed, code: '40004',
        subCode: 'ACQ.TRADE_NOT_EXIST', queryFailed: false, notifications: [] }] };
  }

  it('closes only explicitly listed, confirmed unpaid orders and preserves all order amounts/items', async () => {
    const paymentEvidence = unpaidOrder();
    state.orders.push({ ...clone(state.orders[0]), id: 'retained-order', items: [{ employeeId: 'keep-0' }] });
    const original = clone(state.orders);
    const report = await retireMarketEmployees(prisma, plan, { apply: true, saveBefore: jest.fn(), paymentEvidence });
    expect(report).toMatchObject({ ordersClosed: 1, remainingPublished: 107, protectedDataUnchanged: true });
    expect(state.orders[0]).toMatchObject({ status: 'CLOSED', totalAmount: '100', items: original[0].items });
    expect(state.orders[1]).toEqual(original[1]);
  });

  it('requires separate authorization to close mixed orders', async () => {
    const paymentEvidence = unpaidOrder(true);
    await expect(retireMarketEmployees(prisma, plan, { apply: true, saveBefore: jest.fn(), paymentEvidence })).rejects.toThrow('Mixed order');
    plan.allowMixedUnpaidOrderClosure = true;
    const report = await retireMarketEmployees(prisma, plan, { apply: true, saveBefore: jest.fn(), paymentEvidence });
    expect(report.ordersClosed).toBe(1);
  });

  it.each(['paid', 'stale', 'failed', 'notification', 'sandbox'])('rejects %s payment evidence before any writes', async kind => {
    const paymentEvidence: any = unpaidOrder();
    if (kind === 'paid') Object.assign(paymentEvidence.results[0], { code: '10000', subCode: '', tradeStatus: 'TRADE_SUCCESS' });
    if (kind === 'stale') paymentEvidence.checkedAt = new Date(0).toISOString();
    if (kind === 'failed') paymentEvidence.results[0].queryFailed = true;
    if (kind === 'notification') tx.paymentNotify.findMany.mockResolvedValue([{ id: 'new-notification' }]);
    if (kind === 'sandbox') paymentEvidence.gatewayHost = 'openapi-sandbox.dl.alipaydev.com';
    await expect(retireMarketEmployees(prisma, plan, { apply: true, saveBefore: jest.fn(), paymentEvidence })).rejects.toThrow();
    expect(tx.digitalEmployee.updateMany).not.toHaveBeenCalled();
    expect(state.orders[0].status).toBe('PENDING');
  });
});

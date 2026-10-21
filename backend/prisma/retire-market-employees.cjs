const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const OPERATION = 'market-retirement-2026-10-19';
const PROTECTED_MODELS = ['enterpriseWallet', 'walletTransaction', 'personalWallet',
  'personalWalletTransaction', 'computeUsageRecord', 'contributionRewardEvent',
  'employeeGrant', 'employeeCapabilityBinding', 'capability', 'skillVersion', 'orderItem'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stable = (row, omit) => Object.fromEntries(Object.entries(row).filter(([key]) => !omit.includes(key)));

function validatePlan(plan) {
  assert.equal(plan.operation, OPERATION);
  assert.equal(plan.database, 'sep_prod');
  assert.equal(plan.refundPolicy, 'NO_AUTOMATIC_REFUND');
  assert.equal(plan.archive.length, 74);
  assert.equal(plan.retain.length, 107);
  assert.equal(plan.expectedPublished, 181);
  for (const row of [...plan.archive, ...plan.retain]) {
    assert.ok(typeof row.id === 'string' && row.id && typeof row.name === 'string' && row.name);
  }
  assert.equal(new Set([...plan.archive, ...plan.retain].map(row => row.id)).size, 181);
  const closeIds = plan.closeUnpaidOrderIds || [];
  assert.equal(new Set(closeIds).size, closeIds.length);
  assert.ok(closeIds.every(id => typeof id === 'string' && id));
}

async function protectedState(tx, ids, closeIds) {
  const result = {};
  for (const model of PROTECTED_MODELS) {
    const rows = await tx[model].findMany({ orderBy: { id: 'asc' } });
    result[model] = { count: rows.length, sha256: hash(rows) };
  }
  const subscriptions = await tx.subscription.findMany({
    where: { employeeId: { notIn: ids } }, orderBy: { id: 'asc' },
  });
  result.retainedSubscriptions = { count: subscriptions.length, sha256: hash(subscriptions) };
  const settings = await tx.systemSetting.findMany({ where: { key: 'CONTRIBUTION_REWARDS_ENABLED' } });
  result.rewardSetting = { count: settings.length, sha256: hash(settings) };
  const orders = await tx.order.findMany({ where: { id: { notIn: closeIds } }, orderBy: { id: 'asc' } });
  result.otherOrders = { count: orders.length, sha256: hash(orders) };
  return result;
}

async function retireMarketEmployees(prisma, plan, options = {}) {
  validatePlan(plan);
  const apply = options.apply === true;
  if (apply) assert.equal(typeof options.saveBefore, 'function', 'Private snapshot required before writes');
  return prisma.$transaction(async tx => {
    if (!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    if (apply) await tx.$executeRawUnsafe(
      'LOCK TABLE digital_employees, subscriptions, subscription_credits, orders, order_items, payment_notifies IN SHARE ROW EXCLUSIVE MODE');
    const database = await tx.$queryRawUnsafe('SELECT current_database() AS database');
    assert.equal(database[0].database, plan.database);
    const employees = await tx.digitalEmployee.findMany({ orderBy: { id: 'asc' } });
    const byId = new Map(employees.map(row => [row.id, row]));
    for (const expected of plan.archive) {
      const row = byId.get(expected.id);
      assert.ok(row && row.name === expected.name && ['APPROVED', 'ARCHIVED'].includes(row.status),
        `Archive identity changed: ${expected.id}`);
    }
    for (const expected of plan.retain) {
      const row = byId.get(expected.id);
      assert.ok(row && row.name === expected.name && row.status === 'APPROVED',
        `Retained identity changed: ${expected.id}`);
    }
    const approvedIds = new Set([...plan.archive, ...plan.retain].map(row => row.id));
    assert.ok(employees.every(row => row.status !== 'APPROVED' || approvedIds.has(row.id)),
      'Unreviewed published employees appeared');
    const ids = plan.archive.map(row => row.id);
    const subscriptions = await tx.subscription.findMany({ where: { employeeId: { in: ids } }, orderBy: { id: 'asc' } });
    const subscriptionIds = subscriptions.map(row => row.id);
    const credits = await tx.subscriptionCredit.findMany({ where: { subscriptionId: { in: subscriptionIds } }, orderBy: { id: 'asc' } });
    const now = new Date();
    const running = await tx.gatewayExecution.findMany({ where: { employeeId: { in: ids },
      status: { in: ['STARTED', 'USAGE_PENDING'] }, expiresAt: { gt: now } }, select: { id: true, status: true } });
    const reservations = await tx.mediaRealBillingReservation.findMany({ where: {
      subscriptionId: { in: subscriptionIds }, status: 'RESERVED',
    }, select: { id: true } });
    const pendingOrders = await tx.order.findMany({ where: { status: 'PENDING',
      items: { some: { employeeId: { in: ids } } } }, include: { items: true }, orderBy: { id: 'asc' } });
    const closeIds = plan.closeUnpaidOrderIds || [];
    const toClose = pendingOrders.filter(row => closeIds.includes(row.id));
    if (toClose.length) {
      const evidence = options.paymentEvidence;
      assert.ok(evidence && evidence.database === plan.database && evidence.gatewayHost === 'openapi.alipay.com', 'Production payment evidence required');
      const age = now.getTime() - Date.parse(evidence.checkedAt);
      assert.ok(Number.isFinite(age) && age >= 0 && age < 300_000, 'Payment evidence is stale');
      for (const order of toClose) {
        const proof = evidence.results.find(row => row.id === order.id);
        const mixed = order.items.some(row => !ids.includes(row.employeeId));
        assert.ok(!mixed || plan.allowMixedUnpaidOrderClosure === true, 'Mixed order closure not authorized');
        assert.ok(order.payChannel === null && order.payTradeNo === null && order.paidAt === null, 'Order has local payment evidence');
        assert.ok(proof && proof.orderNo === order.orderNo && proof.amount === order.totalAmount.toString()
          && proof.mixed === mixed && !proof.queryFailed && proof.notifications.length === 0
          && ((proof.code === '40004' && proof.subCode === 'ACQ.TRADE_NOT_EXIST')
            || (proof.code === '10000' && proof.tradeStatus === 'TRADE_CLOSED')), 'Order not confirmed unpaid');
        const notifications = await tx.paymentNotify.findMany({ where: { outTradeNo: order.orderNo } });
        assert.equal(notifications.length, 0, 'Payment notification arrived after preflight');
      }
    }
    const pendingRequests = await tx.subscriptionRequest.findMany({ where: {
      employeeId: { in: ids }, status: 'PENDING',
    }, select: { id: true } });
    const blockers = { running, reservations,
      pendingOrders: pendingOrders.filter(row => !closeIds.includes(row.id)).map(row => ({ id: row.id })), pendingRequests };
    const beforeProtected = await protectedState(tx, ids, closeIds);
    const toArchive = plan.archive.filter(row => byId.get(row.id).status === 'APPROVED');
    const toTerminate = subscriptions.filter(row => ['ACTIVE', 'PAUSED'].includes(row.status));
    const toExpire = credits.filter(row => row.status !== 'EXPIRED');
    const report = { operation: OPERATION, database: plan.database, apply,
      checkedAt: now.toISOString(), blockers,
      archived: toArchive.length, terminated: toTerminate.length, creditsExpired: toExpire.length,
      retained: plan.retain.length, affectedSubscriptionRecords: subscriptions.length,
      ordersClosed: toClose.length, refundsCreated: 0, protectedBefore: beforeProtected };
    if (!apply) return report;
    assert.ok(Object.values(blockers).every(rows => rows.length === 0), 'In-flight work or pending purchases require separate handling');
    await options.saveBefore({ operation: OPERATION, capturedAt: now.toISOString(),
      employees: employees.filter(row => ids.includes(row.id)), subscriptions, credits, orders: toClose,
      paymentEvidence: options.paymentEvidence, protected: beforeProtected });
    const closed = await tx.order.updateMany({ where: { id: { in: toClose.map(row => row.id) },
      status: 'PENDING', payChannel: null, payTradeNo: null, paidAt: null }, data: { status: 'CLOSED', closedAt: now } });
    assert.equal(closed.count, toClose.length);
    const archived = await tx.digitalEmployee.updateMany({
      where: { id: { in: toArchive.map(row => row.id) }, status: 'APPROVED' }, data: { status: 'ARCHIVED' },
    });
    assert.equal(archived.count, toArchive.length);
    for (const row of toTerminate) {
      const result = await tx.subscription.updateMany({ where: { id: row.id, status: row.status }, data: {
        status: 'TERMINATED', endDate: row.endDate && row.endDate < now ? row.endDate : now,
        terminatedAt: now, terminatedBy: `maintenance:${OPERATION}`,
        terminatedReason: '平台员工目录下线；用户明确要求立即停用；本次不自动退款，保留原账务。',
      } });
      assert.equal(result.count, 1);
    }
    const expired = await tx.subscriptionCredit.updateMany({
      where: { id: { in: toExpire.map(row => row.id) }, status: { not: 'EXPIRED' } }, data: { status: 'EXPIRED' },
    });
    assert.equal(expired.count, toExpire.length);
    const after = await tx.digitalEmployee.findMany({ orderBy: { id: 'asc' } });
    assert.equal(after.length, employees.length);
    for (let index = 0; index < employees.length; index++) {
      const before = employees[index];
      const row = after[index];
      assert.deepEqual(stable(row, ['status', 'updatedAt']), stable(before, ['status', 'updatedAt']));
      assert.equal(row.status, ids.includes(row.id) ? 'ARCHIVED' : before.status);
      if (!ids.includes(row.id)) assert.deepEqual(row, before);
    }
    const afterSubscriptions = await tx.subscription.findMany({ where: { employeeId: { in: ids } }, orderBy: { id: 'asc' } });
    assert.equal(afterSubscriptions.length, subscriptions.length);
    const terminatedIds = new Set(toTerminate.map(row => row.id));
    const changedFields = ['status', 'endDate', 'terminatedAt', 'terminatedBy', 'terminatedReason', 'updatedAt'];
    for (let index = 0; index < subscriptions.length; index++) {
      assert.deepEqual(stable(afterSubscriptions[index], changedFields), stable(subscriptions[index], changedFields));
      if (terminatedIds.has(subscriptions[index].id)) assert.equal(afterSubscriptions[index].status, 'TERMINATED');
      else assert.deepEqual(afterSubscriptions[index], subscriptions[index]);
    }
    const afterCredits = await tx.subscriptionCredit.findMany({ where: { subscriptionId: { in: subscriptionIds } }, orderBy: { id: 'asc' } });
    assert.equal(afterCredits.length, credits.length);
    for (let index = 0; index < credits.length; index++) {
      assert.deepEqual(stable(afterCredits[index], ['status', 'updatedAt']), stable(credits[index], ['status', 'updatedAt']));
      assert.equal(afterCredits[index].status, 'EXPIRED');
    }
    const closedOrders = await tx.order.findMany({ where: { id: { in: toClose.map(row => row.id) } },
      include: { items: true }, orderBy: { id: 'asc' } });
    assert.equal(closedOrders.length, toClose.length);
    for (let index = 0; index < toClose.length; index++) {
      assert.equal(closedOrders[index].status, 'CLOSED');
      assert.deepEqual(stable(closedOrders[index], ['status', 'closedAt', 'updatedAt']),
        stable(toClose[index], ['status', 'closedAt', 'updatedAt']));
    }
    const afterProtected = await protectedState(tx, ids, closeIds);
    assert.deepEqual(afterProtected, beforeProtected, 'Protected data changed; roll back');
    return { ...report, protectedAfter: afterProtected, protectedDataUnchanged: true,
      remainingPublished: after.filter(row => row.status === 'APPROVED').length };
  }, { isolationLevel: 'Serializable', timeout: 60_000, maxWait: 10_000 });
}

async function main() {
  const [mode, planPath, reportDirectory, expectedHash, paymentEvidencePath] = process.argv.slice(2);
  assert.ok(['preview', 'apply'].includes(mode) && planPath && reportDirectory);
  const raw = fs.readFileSync(planPath, 'utf8');
  if (mode === 'apply') assert.equal(createHash('sha256').update(raw).digest('hex'), expectedHash, 'Approved plan hash mismatch');
  const plan = JSON.parse(raw);
  const backendRequire = createRequire(path.resolve(process.cwd(), 'package.json'));
  const { PrismaClient } = backendRequire('@prisma/client');
  const prisma = new PrismaClient();
  fs.mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(reportDirectory, 0o700);
  const timestamp = Date.now();
  try {
    const report = await retireMarketEmployees(prisma, plan, { apply: mode === 'apply',
      paymentEvidence: paymentEvidencePath ? JSON.parse(fs.readFileSync(paymentEvidencePath, 'utf8')) : undefined,
      saveBefore: snapshot => fs.writeFileSync(path.join(reportDirectory, `before-${timestamp}.json`),
        JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' }),
    });
    fs.writeFileSync(path.join(reportDirectory, `${mode}-${timestamp}.json`), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
  } finally { await prisma.$disconnect(); }
}

module.exports = { retireMarketEmployees, validatePlan, hash, PROTECTED_MODELS };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

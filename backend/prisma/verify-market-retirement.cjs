const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(process.cwd(), 'package.json'));
const { PrismaClient } = backendRequire('@prisma/client');

function loadDeployedModule(exportName) {
  const filename = path.resolve('dist/main.js');
  const source = fs.readFileSync(filename, 'utf8');
  const marker = `exports.${exportName} =`;
  const offset = source.indexOf(marker);
  assert.ok(offset >= 0, `Deployed export missing: ${exportName}`);
  const headers = [...source.slice(0, offset).matchAll(/\/\* (\d+) \*\//g)];
  const moduleId = Number(headers.at(-1)?.[1]);
  assert.ok(Number.isInteger(moduleId) && moduleId > 0);
  const startup = 'var __webpack_exports__ = __webpack_require__(0);';
  assert.equal(source.split(startup).length, 2, 'Unrecognized bundle startup');
  const isolated = { exports: {} };
  // Expose the bundle loader in memory, without running Nest bootstrap or modifying the deployed file.
  new Function('require', 'module', 'exports', '__dirname', '__filename',
    source.replace(startup, 'module.exports = __webpack_require__;'))(
    createRequire(filename), isolated, isolated.exports, path.dirname(filename), filename);
  const loaded = isolated.exports(moduleId)[exportName];
  assert.equal(typeof loaded, 'function');
  return loaded;
}

async function main() {
  const [planPath, reportPath] = process.argv.slice(2);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const GatewayService = loadDeployedModule('GatewayService');
  const OrderService = loadDeployedModule('OrderService');
  const accessWhere = loadDeployedModule('clientSubscriptionAccessWhere');
  const prisma = new PrismaClient();
  try {
    const report = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const database = await tx.$queryRawUnsafe('SELECT current_database() AS database');
      assert.equal(database[0].database, plan.database);
      const ids = plan.archive.map(row => row.id);
      const archived = await tx.digitalEmployee.count({ where: { id: { in: ids }, status: 'ARCHIVED' } });
      const published = await tx.digitalEmployee.count({ where: { status: 'APPROVED' } });
      assert.equal(archived, 74);
      assert.equal(published, 107);
      const subscriptions = await tx.subscription.findMany({ where: { employeeId: { in: ids } } });
      assert.ok(subscriptions.every(row => !['ACTIVE', 'PAUSED'].includes(row.status)));
      const creditsAvailable = await tx.subscriptionCredit.count({ where: {
        subscriptionId: { in: subscriptions.map(row => row.id) }, status: { not: 'EXPIRED' },
      } });
      assert.equal(creditsAvailable, 0);
      const gateway = new GatewayService(tx, null, null, null, null);
      for (const row of subscriptions) {
        // No tokens are minted: invoke the real compiled authorization method inside a read-only transaction.
        await assert.rejects(() => gateway.validateAndAuthorize({ enterpriseId: row.enterpriseId,
          subscriptionId: row.id, memberId: '', sub: '' }),
        error => error.getStatus?.() === 403 && error.getResponse?.().error?.code === 'SUBSCRIPTION_INACTIVE');
        const access = await tx.subscription.findFirst({ where: accessWhere({
          enterpriseId: row.enterpriseId, memberId: '', departmentId: null,
        }, row.id) });
        assert.equal(access, null);
      }
      const orders = await tx.order.findMany({ where: { id: { in: plan.closeUnpaidOrderIds } } });
      assert.equal(orders.length, 22);
      const orderService = new OrderService(tx, null);
      for (const row of orders) {
        assert.equal(row.status, 'CLOSED');
        assert.equal(row.paidAt, null);
        await assert.rejects(() => orderService.fulfillInTransaction(tx, row.id, 'READ_ONLY_VERIFICATION'),
          error => error.getStatus?.() === 400);
      }
      const pendingOrders = await tx.order.count({ where: { status: 'PENDING',
        items: { some: { employeeId: { in: ids } } } } });
      assert.equal(pendingOrders, 0);
      return { checkedAt: new Date().toISOString(), database: plan.database, archived, published,
        targetActiveOrPaused: 0, creditsAvailable, gatewayRejected: subscriptions.length,
        clientAccessRejected: subscriptions.length, closedOrders: orders.length,
        fulfillmentRejected: orders.length, pendingOrders,
        method: 'Current deployed bundle service methods; read-only transaction; no HTTP authentication or model calls' };
    }, { timeout: 60_000 });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
  } finally { await prisma.$disconnect(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

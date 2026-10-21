const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(process.cwd(), 'package.json'));
const { PrismaClient } = backendRequire('@prisma/client');
const SdkModule = backendRequire('alipay-sdk');
const AlipaySdk = SdkModule.AlipaySdk || SdkModule.default || SdkModule;

async function main() {
  const [planPath, reportPath] = process.argv.slice(2);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const prisma = new PrismaClient();
  try {
    const database = await prisma.$queryRawUnsafe('SELECT current_database() AS database');
    assert.equal(database[0].database, plan.database);
    const ids = plan.archive.map(row => row.id);
    const orders = await prisma.order.findMany({ where: { status: 'PENDING',
      items: { some: { employeeId: { in: ids } } } }, include: { items: true }, orderBy: { id: 'asc' } });
    const settings = await prisma.systemSetting.findMany({ where: { key: { in: [
      'alipay.appId', 'alipay.privateKey', 'alipay.publicKey', 'alipay.gateway',
    ] } } });
    const values = Object.fromEntries(settings.map(row => [row.key, row.value]));
    assert.ok(values['alipay.appId'] && values['alipay.privateKey'] && values['alipay.publicKey'], 'Payment configuration incomplete');
    const gateway = values['alipay.gateway'] || 'https://openapi.alipay.com/gateway.do';
    const sdk = new AlipaySdk({ appId: values['alipay.appId'], privateKey: values['alipay.privateKey'],
      alipayPublicKey: values['alipay.publicKey'], gateway, charset: 'utf-8', signType: 'RSA2', keyType: 'PKCS8' });
    const results = [];
    for (const order of orders) {
      let trade;
      try {
        trade = await sdk.exec('alipay.trade.query', { bizContent: { out_trade_no: order.orderNo } });
      } catch (error) {
        trade = { code: error.code, subCode: error.subCode, queryFailed: true };
      }
      const notifications = await prisma.paymentNotify.findMany({ where: { outTradeNo: order.orderNo },
        select: { verified: true, processed: true } });
      const result = { id: order.id, orderNo: order.orderNo,
        mixed: order.items.some(row => !ids.includes(row.employeeId)),
        amount: order.totalAmount.toString(), createdAt: order.createdAt,
        code: trade?.code, subCode: trade?.subCode ?? trade?.sub_code,
        tradeStatus: trade?.tradeStatus ?? trade?.trade_status,
        queryFailed: trade?.queryFailed === true, notifications };
      results.push(result);
      console.log(JSON.stringify(result));
    }
    const report = { checkedAt: new Date().toISOString(), database: plan.database,
      gatewayHost: new URL(gateway).hostname, results };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  } finally { await prisma.$disconnect(); }
}

main().catch(() => { console.error('Payment preflight failed; no database writes performed'); process.exitCode = 1; });

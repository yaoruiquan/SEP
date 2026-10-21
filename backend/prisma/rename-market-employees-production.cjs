const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const OPERATION = 'market-rename-employees-production-2026-10-19';
const PROTECTED_MODELS = [
  'employeeCapabilityBinding', 'capability', 'skillVersion', 'skillConfig',
  'subscription', 'employeeGrant', 'subscriptionSkillVersion', 'enterpriseSkillDefault',
  'contributionRewardEvent', 'personalWalletTransaction', 'personalWallet',
  'enterpriseWallet', 'walletTransaction', 'computeUsageRecord',
];

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stable = (row, omit = []) => Object.fromEntries(
  Object.entries(row).filter(([key]) => !omit.includes(key)),
);

function validatePlan(plan) {
  assert.equal(plan.operation, OPERATION);
  assert.equal(plan.database, 'sep_prod');
  assert.equal(plan.expectedPublished, 107);
  assert.equal(plan.changes.length, 101);
  assert.equal(new Set(plan.changes.map(row => row.id)).size, plan.changes.length);
  assert.equal(new Set(plan.changes.map(row => row.before)).size, plan.changes.length);
  assert.equal(new Set(plan.changes.map(row => row.after)).size, plan.changes.length);
  for (const row of plan.changes) {
    assert.ok(row.id && row.before && row.after && row.before !== row.after);
  }
}

async function protectedState(tx) {
  const result = {};
  for (const model of PROTECTED_MODELS) {
    const rows = await tx[model].findMany({ orderBy: { id: 'asc' } });
    result[model] = { count: rows.length, sha256: hash(rows) };
  }
  const settings = await tx.systemSetting.findMany({
    where: { key: 'CONTRIBUTION_REWARDS_ENABLED' }, orderBy: { key: 'asc' },
  });
  result.rewardSetting = { count: settings.length, sha256: hash(settings) };
  return result;
}

async function renameProductionEmployees(prisma, plan, options = {}) {
  validatePlan(plan);
  const apply = options.apply === true;
  if (apply) assert.equal(typeof options.saveBefore, 'function', 'Private snapshot required before writes');
  return prisma.$transaction(async tx => {
    if (!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    if (apply) await tx.$executeRawUnsafe(
      'LOCK TABLE digital_employees IN SHARE ROW EXCLUSIVE MODE');
    const database = await tx.$queryRawUnsafe('SELECT current_database() AS database');
    assert.equal(database[0].database, plan.database);
    const employees = await tx.digitalEmployee.findMany({ orderBy: { id: 'asc' } });
    const byId = new Map(employees.map(row => [row.id, row]));
    const targetIds = new Set(plan.changes.map(row => row.id));
    for (const expected of plan.changes) {
      const row = byId.get(expected.id);
      assert.ok(row && row.status === 'APPROVED' && row.name === expected.before,
        `Production identity changed: ${expected.id}`);
    }
    assert.equal(employees.filter(row => row.status === 'APPROVED').length, plan.expectedPublished);
    for (const expected of plan.changes) {
      const collision = employees.find(row => row.id !== expected.id && row.name === expected.after);
      assert.ok(!collision, `Target name already exists: ${expected.after}`);
    }
    const beforeProtected = await protectedState(tx);
    const report = {
      operation: OPERATION, database: plan.database, apply,
      checkedAt: new Date().toISOString(), planned: plan.changes.length,
      changed: plan.changes.length, published: plan.expectedPublished,
      protectedBefore: beforeProtected,
    };
    if (!apply) return report;
    await options.saveBefore({ operation: OPERATION, capturedAt: report.checkedAt,
      employees: employees.filter(row => targetIds.has(row.id)), protected: beforeProtected });
    for (const expected of plan.changes) {
      const result = await tx.digitalEmployee.updateMany({
        where: { id: expected.id, name: expected.before, status: 'APPROVED' },
        data: { name: expected.after },
      });
      assert.equal(result.count, 1, `Rename failed: ${expected.id}`);
    }
    const after = await tx.digitalEmployee.findMany({ orderBy: { id: 'asc' } });
    assert.equal(after.length, employees.length);
    for (let index = 0; index < employees.length; index++) {
      const before = employees[index];
      const row = after[index];
      const expected = plan.changes.find(change => change.id === row.id);
      assert.deepEqual(stable(row, ['name', 'updatedAt']), stable(before, ['name', 'updatedAt']));
      assert.equal(row.name, expected ? expected.after : before.name);
      if (!expected) assert.deepEqual(row, before);
    }
    const afterProtected = await protectedState(tx);
    assert.deepEqual(afterProtected, beforeProtected, 'Protected data changed; roll back');
    return { ...report, protectedAfter: afterProtected, protectedDataUnchanged: true };
  }, { isolationLevel: 'Serializable', timeout: 60_000, maxWait: 10_000 });
}

async function main() {
  const [mode, planPath, reportDirectory, expectedHash] = process.argv.slice(2);
  assert.ok(['preview', 'apply'].includes(mode) && planPath && reportDirectory);
  const raw = fs.readFileSync(planPath, 'utf8');
  if (mode === 'apply') {
    assert.equal(createHash('sha256').update(raw).digest('hex'), expectedHash, 'Approved plan hash mismatch');
  }
  const plan = JSON.parse(raw);
  const backendRequire = createRequire(path.resolve(process.cwd(), 'package.json'));
  const { PrismaClient } = backendRequire('@prisma/client');
  const prisma = new PrismaClient();
  fs.mkdirSync(reportDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(reportDirectory, 0o700);
  const timestamp = Date.now();
  try {
    const report = await renameProductionEmployees(prisma, plan, { apply: mode === 'apply',
      saveBefore: snapshot => fs.writeFileSync(path.join(reportDirectory, `before-${timestamp}.json`),
        JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' }),
    });
    fs.writeFileSync(path.join(reportDirectory, `${mode}-${timestamp}.json`),
      JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
  } finally { await prisma.$disconnect(); }
}

module.exports = { renameProductionEmployees, validatePlan, hash, PROTECTED_MODELS };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

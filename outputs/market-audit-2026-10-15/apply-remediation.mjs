import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(`${root}backend/package.json`);
process.loadEnvFile(`${root}backend/.env`);
require('ts-node').register({ project: `${root}backend/tsconfig.json`, transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: `${root}backend/src`, paths: { shared: ['shared'] } });
const { PrismaService } = require(`${root}backend/src/prisma/prisma.service.ts`);
const { ConfigService } = require('@nestjs/config');
const { SettingService } = require(`${root}backend/src/modules/setting/setting.service.ts`);
const { SkillVersionService } = require(`${root}backend/src/modules/skill-version/skill-version.service.ts`);
const { SkillPackageService } = require(`${root}backend/src/modules/skill-package/skill-package.service.ts`);
const { ClientSkillArtifactService } = require(`${root}backend/src/modules/client/client-skill-artifact.service.ts`);
const { EmployeeReadinessService } = require(`${root}backend/src/modules/digital-employee/employee-readiness.service.ts`);
const { buildMarketRemediationPlan, contentHash } = require(`${root}backend/prisma/market-remediation-plan.ts`);
const apply = process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(arg => arg === '--apply'), '仅支持 --apply，默认只读预演');
const host = new URL(process.env.DATABASE_URL).hostname;
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(host), '只允许连接本地数据库');
const audit = JSON.parse(await readFile(new URL('./employees.json', import.meta.url), 'utf8'));
const plan = buildMarketRemediationPlan(audit.employees);
const prisma = new PrismaService();
const config = new ConfigService();
const settings = new SettingService(prisma, config);
const packages = new SkillPackageService(config);
const artifacts = new ClientSkillArtifactService(null, null, null, packages);
const readiness = new EmployeeReadinessService(prisma, artifacts);
const versions = new SkillVersionService(prisma, null, undefined, undefined, undefined, undefined, packages, undefined, settings);
const report = { startedAt: new Date().toISOString(), host, apply, counts: plan.counts,
  published: [], employeeUpdates: [], migratedBindings: [], archived: [],
  businessAcceptance: 'PENDING_CLIENT_E2E', outcome: 'PREFLIGHT' };
const runDirectory = fileURLToPath(new URL(`../market-remediation-2026-10-15/${Date.now()}-${apply ? 'apply' : 'preview'}/`, import.meta.url));
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const save = async () => writeFile(`${runDirectory}report.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

async function protectedState(db) {
  const [subscriptions, grants, selections, defaults, rewards, transactions, wallets] = await Promise.all([
    db.subscription.findMany({ orderBy: { id: 'asc' } }),
    db.employeeGrant.findMany({ orderBy: { id: 'asc' } }),
    db.subscriptionSkillVersion.findMany({ orderBy: { id: 'asc' } }),
    db.enterpriseSkillDefault.findMany({ orderBy: { id: 'asc' } }),
    db.contributionRewardEvent.findMany({ orderBy: { id: 'asc' } }),
    db.personalWalletTransaction.findMany({ where: { relatedType: 'contribution_reward' }, orderBy: { id: 'asc' } }),
    db.personalWallet.findMany({ select: { id: true, balance: true }, orderBy: { id: 'asc' } }),
  ]);
  return { subscriptions: { count: subscriptions.length, hash: fingerprint(subscriptions) },
    grants: { count: grants.length, hash: fingerprint(grants) },
    selections: { count: selections.length, hash: fingerprint(selections) },
    defaults: { count: defaults.length, hash: fingerprint(defaults) },
    rewards: { count: rewards.length, hash: fingerprint(rewards) },
    transactions: { count: transactions.length, hash: fingerprint(transactions) },
    walletBalances: { count: wallets.length, hash: fingerprint(wallets) } };
}

async function assertRewardsDisabled() {
  assert.equal(await settings.getEffectiveValue('CONTRIBUTION_REWARDS_ENABLED'), 'false', '奖励必须明确关闭');
}

try {
  await assertRewardsDisabled();
  const before = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const employees = await tx.digitalEmployee.findMany({ where: { id: { in: audit.employees.map(e => e.id) } },
      include: { bindings: { include: { capability: true, defaultSkillVersion: true } } }, orderBy: { id: 'asc' } });
    const capabilities = await tx.capability.findMany({ where: { id: { in: [...new Set(audit.employees.flatMap(e => e.bindings.map(b => b.capabilityId)))] } },
      include: { skillVersions: { where: { scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
        orderBy: [{ platformReviewedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }] } } });
    const admin = await tx.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true }, orderBy: { id: 'asc' } });
    return { employees, capabilities, admin, protected: await protectedState(tx) };
  }, { timeout: 30_000, isolationLevel: 'RepeatableRead' });
  assert.ok(before.admin, '缺少有效平台管理员');
  assert.equal(before.employees.length, 107);
  const byCapability = new Map(before.capabilities.map(c => [c.id, c]));
  const revisionByCapability = new Map(plan.revisions.map(r => [r.capabilityId, r]));
  const migrationVersion = (migration, capability) => {
    const evidence = audit.employees.find(e => e.id === migration.sourceId).evidence.find(e => e.capabilityId === migration.capabilityId);
    const original = capability.skillVersions.find(v => v.id === migration.versionId);
    assert.ok(original && contentHash(original.content) === evidence.approvedContentSha256, `迁移内容已变化：${capability.name}`);
    return original;
  };
  for (const migration of plan.migrations) migrationVersion(migration, byCapability.get(migration.capabilityId));
  for (const employee of before.employees) {
    const original = audit.employees.find(e => e.id === employee.id);
    const patch = plan.patches.get(employee.id);
    assert.equal(employee.name, original.name);
    assert.equal(employee.status, 'APPROVED', `${employee.name} 状态已变`);
    for (const field of ['description', 'systemPrompt']) {
      assert.ok(employee[field] === original[field] || (patch?.[field] !== undefined && employee[field] === patch[field]), `${employee.name} ${field} 已变化，须重新审阅`);
    }
    const additions = plan.migrations.filter(row => row.targetId === employee.id);
    for (const binding of employee.bindings) {
      const old = original.bindings.find(b => b.capabilityId === binding.capabilityId);
      assert.ok(old || additions.some(row => row.capabilityId === binding.capabilityId), `${employee.name} 出现未审阅绑定`);
      assert.equal(binding.enabled, old?.enabled ?? true);
      if (old) { assert.equal(binding.id, old.id); assert.equal(binding.priority, old.priority); }
      const revision = revisionByCapability.get(binding.capabilityId);
      const head = byCapability.get(binding.capabilityId).skillVersions[0];
      const effective = binding.defaultSkillVersion ?? head;
      const evidence = audit.employees.flatMap(e => e.evidence).find(e => e.capabilityId === binding.capabilityId);
      assert.ok(effective && ((effective.id === evidence.versionId && contentHash(effective.content) === evidence.approvedContentSha256) ||
        (revision && effective.id === head.id && effective.content === revision.content)), `${employee.name} 绑定版本已变化`);
    }
    for (const binding of original.bindings) assert.ok(employee.bindings.some(b => b.id === binding.id), `${employee.name} 原绑定丢失`);
  }
  for (const revision of plan.revisions) {
    const capability = byCapability.get(revision.capabilityId);
    const head = capability?.skillVersions[0];
    assert.ok(capability && head && capability.status === 'APPROVED' && capability.enterpriseId === null);
    assert.ok((head.id === revision.expectedPlatformVersionId && contentHash(head.content) === revision.expectedContentSha256) ||
      (head.content === revision.content && head.parentVersionId === revision.expectedPlatformVersionId), `${capability.name} 正式头部已变化`);
  }
  // Validate the exact projected binding set without writing during preview.
  for (const employee of before.employees) {
    const projected = employee.bindings.map(binding => ({ ...binding }));
    for (const migration of plan.migrations.filter(row => row.targetId === employee.id)) {
      if (projected.some(b => b.capabilityId === migration.capabilityId)) continue;
      const capability = byCapability.get(migration.capabilityId);
      const version = migrationVersion(migration, capability);
      projected.push({ capabilityId: capability.id, capability, defaultSkillVersionId: version.id, defaultSkillVersion: version, enabled: true });
    }
    for (const binding of projected) {
      const revision = revisionByCapability.get(binding.capabilityId);
      if (revision) {
        binding.defaultSkillVersion = { ...byCapability.get(binding.capabilityId).skillVersions[0], content: revision.content };
        binding.defaultSkillVersionId = binding.defaultSkillVersion.id;
      }
    }
    await readiness.assertReady(employee.id, {
      employeeCapabilityBinding: { findMany: async () => projected.filter(b => b.enabled) },
      skillVersion: { findFirst: async ({ where }) => byCapability.get(where.capabilityId)?.skillVersions[0] ?? null },
    });
  }
  report.preflight = { employees: 107, projectedReady: 107, revisions: plan.revisions.length,
    employeeUpdates: plan.patches.size, targetEmployees: plan.targets.length, distinctMigrationBindings: plan.migrations.length,
    rewardsEnabled: false, protectedState: before.protected };
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  if (apply) {
    await writeFile(`${runDirectory}before.json`, `${JSON.stringify(before, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await save();
    for (const revision of plan.revisions) {
      await assertRewardsDisabled();
      const current = await prisma.skillVersion.findFirst({ where: { capabilityId: revision.capabilityId, scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
        orderBy: [{ platformReviewedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }] });
      let published = current;
      if (current.content !== revision.content) {
        const pending = await versions.createPlatformRevision(before.admin.id, revision.capabilityId, revision);
        published = await versions.publishPlatformVersion(before.admin.id, pending.id, {
          expectedUpdatedAt: pending.updatedAt.toISOString(), expectedPlatformVersionId: revision.expectedPlatformVersionId,
          changeSummary: revision.changeSummary,
        });
      }
      const affected = before.employees.filter(e => e.bindings.some(b => b.enabled && b.capabilityId === revision.capabilityId));
      for (const employee of affected) await readiness.assertReady(employee.id);
      report.published.push({ capabilityId: revision.capabilityId, versionId: published.id, version: published.version,
        publication: current.content === revision.content ? 'ALREADY_APPLIED' : 'CREATED_AND_APPROVED',
        contentSha256: contentHash(published.content), affectedEmployeeIds: affected.map(e => e.id) });
      await save();
    }
    const employeeUpdates = [];
    const migratedBindings = [];
    await prisma.$transaction(async tx => {
      await assertRewardsDisabled();
      for (const id of [...plan.patches.keys()].sort()) {
        await tx.$queryRaw`SELECT id FROM digital_employees WHERE id = ${id} FOR UPDATE`;
        const employee = await tx.digitalEmployee.findUniqueOrThrow({ where: { id } });
        const original = audit.employees.find(e => e.id === id);
        const patch = plan.patches.get(id);
        assert.equal(employee.status, 'APPROVED');
        for (const field of ['description', 'systemPrompt']) assert.ok(employee[field] === original[field] || employee[field] === patch[field], `并发修改：${employee.name}`);
        if (employee.systemPrompt !== patch.systemPrompt || (patch.description !== undefined && employee.description !== patch.description)) {
          await tx.digitalEmployee.update({ where: { id }, data: patch });
          employeeUpdates.push({ id, name: employee.name });
        }
      }
      for (const migration of plan.migrations) {
        const existing = await tx.employeeCapabilityBinding.findUnique({ where: { employeeId_capabilityId: {
          employeeId: migration.targetId, capabilityId: migration.capabilityId,
        } } });
        const published = report.published.find(row => row.capabilityId === migration.capabilityId);
        const version = await tx.skillVersion.findUniqueOrThrow({ where: { id: published?.versionId ?? migration.versionId } });
        const expectedSha = published?.contentSha256 ?? contentHash(migrationVersion(migration, byCapability.get(migration.capabilityId)).content);
        assert.ok(version.capabilityId === migration.capabilityId && version.scope === 'PLATFORM' &&
          version.status === 'PLATFORM_APPROVED' && contentHash(version.content) === expectedSha, '迁移版本已变化');
        if (existing) {
          assert.ok(existing.enabled && existing.defaultSkillVersionId === version.id, '已有迁移绑定与计划不符');
          continue;
        }
        await tx.employeeCapabilityBinding.create({ data: { employeeId: migration.targetId, capabilityId: migration.capabilityId,
          enabled: true, priority: 10, defaultSkillVersionId: version.id } });
        migratedBindings.push({ ...migration, installedVersionId: version.id });
      }
      for (const id of plan.patches.keys()) await readiness.assertReady(id, tx);
    }, { timeout: 60_000, isolationLevel: 'Serializable' });
    report.employeeUpdates = employeeUpdates;
    report.migratedBindings = migratedBindings;
    report.templateTransactionCommitted = true;
    await save();
  }
  const after = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    for (const employee of before.employees) await readiness.assertReady(employee.id, tx);
    return { protected: await protectedState(tx),
      approvedEmployees: await tx.digitalEmployee.count({ where: { status: 'APPROVED' } }),
      archivedEmployees: await tx.digitalEmployee.count({ where: { status: 'ARCHIVED' } }) };
  }, { timeout: 60_000, isolationLevel: 'RepeatableRead' });
  assert.deepEqual(after.protected, before.protected, '订阅、授权、企业选版或奖励钱包发生变化');
  await assertRewardsDisabled();
  report.verification = { staticReady: 107, protectedStateUnchanged: true, ...after };
  report.acceptanceQueue = plan.targets.flatMap(group => group.sources.map(source => ({ sourceId: source.id, sourceName: source.name,
    targetId: group.employee.id, targetName: group.employee.name, sourceTask: source.acceptance, targetTask: group.employee.acceptance,
    capabilityMigration: apply ? 'APPLIED' : 'PREVIEW', businessAcceptance: 'NOT_RUN', entryStatus: 'APPROVED_PENDING_ACCEPTANCE' })));
  report.outcome = apply ? 'APPLIED_PENDING_BUSINESS_ACCEPTANCE' : 'PREVIEW_PASSED';
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ ...report, acceptanceQueue: `${report.acceptanceQueue.length} source/target tasks`,
    report: `${runDirectory}report.json` }, null, 2));
} catch (error) {
  report.outcome = 'FAILED_OR_PARTIALLY_APPLIED';
  report.error = error instanceof Error ? error.message : String(error);
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await save();
  console.error(JSON.stringify({ error: report.error, report: `${runDirectory}report.json` }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

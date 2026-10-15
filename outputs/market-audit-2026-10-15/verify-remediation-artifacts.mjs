import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const clientRoot = resolve(root, '../sep-client');
const require = createRequire(resolve(root, 'backend/package.json'));
const clientRequire = createRequire(resolve(clientRoot, 'package.json'));
process.loadEnvFile(resolve(root, 'backend/.env'));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname));
require('ts-node').register({ project: resolve(root, 'backend/tsconfig.json'), transpileOnly: true });
require('tsconfig-paths').register({ baseUrl: resolve(root, 'backend/src'), paths: { shared: ['shared'] } });
const { PrismaService } = require(resolve(root, 'backend/src/prisma/prisma.service.ts'));
const { ConfigService } = require('@nestjs/config');
const { SkillPackageService } = require(resolve(root, 'backend/src/modules/skill-package/skill-package.service.ts'));
const { ClientSkillArtifactService } = require(resolve(root, 'backend/src/modules/client/client-skill-artifact.service.ts'));
const { buildMarketRemediationPlan, contentHash } = require(resolve(root, 'backend/prisma/market-remediation-plan.ts'));
const preview = process.argv.includes('--preview');
assert.ok(process.argv.slice(2).every(arg => arg === '--preview'));
const audit = JSON.parse(readFileSync(new URL('./employees.json', import.meta.url), 'utf8'));
const plan = buildMarketRemediationPlan(audit.employees);
const ts = clientRequire('typescript');
const cache = new Map();

function loadClient(relative, expose = '') {
  const filename = resolve(clientRoot, relative);
  if (cache.has(filename)) return cache.get(filename);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8') + expose, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const scopedRequire = id => {
    if (!id.startsWith('.')) return clientRequire(id);
    if (/\/(?:employee-runtime-contract|skill-artifact-contract|skill-package-parser|skill-package-zip)$/.test(id)) {
      return loadClient(resolve(dirname(filename), `${id}.ts`));
    }
    // Immutable parsing does not call the client network or persistence modules.
    return {};
  };
  runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(scopedRequire, module, module.exports);
  return module.exports;
}

const { approvedEntry } = loadClient('electron/pi/sdk/pi-skill-packages.ts', '\nexport { approvedEntry };\n');
const { skillArtifactSchema } = loadClient('electron/common/platform/skill-artifact-contract.ts');
const prisma = new PrismaService();
const artifacts = new ClientSkillArtifactService(null, null, null, new SkillPackageService(new ConfigService()));
try {
  const employees = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const rows = await tx.digitalEmployee.findMany({ where: { id: { in: audit.employees.map(e => e.id) } },
      include: { bindings: { where: { enabled: true }, include: { defaultSkillVersion: true, capability: true } } },
      orderBy: { id: 'asc' } });
    for (const employee of rows) for (const binding of employee.bindings) {
      if (binding.capability.type !== 'SKILL') continue;
      if (!binding.defaultSkillVersion) binding.defaultSkillVersion = await tx.skillVersion.findFirstOrThrow({
        where: { capabilityId: binding.capabilityId, scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
        orderBy: [{ platformReviewedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
      });
    }
    return rows;
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
  assert.equal(employees.length, 107);
  const results = new Map();
  const employeeResults = [];
  for (const employee of employees) {
    assert.equal(employee.status, 'APPROVED');
    const directories = new Set();
    for (const binding of employee.bindings) {
      if (binding.capability.type !== 'SKILL') continue;
      let version = binding.defaultSkillVersion;
      assert.ok(version?.status === 'PLATFORM_APPROVED' && version.scope === 'PLATFORM' && version.capabilityId === binding.capabilityId);
      const revision = plan.revisions.find(r => r.capabilityId === binding.capabilityId);
      if (revision && preview) version = { ...version, content: revision.content };
      if (revision && !preview) assert.equal(version.content, revision.content, '正式修订尚未生效');
      let result = results.get(version.id);
      if (!result) {
        const prepared = await artifacts.prepare(employee.id, binding.capabilityId, version);
        const descriptor = skillArtifactSchema.parse(prepared.descriptor);
        assert.equal(descriptor.status, 'AVAILABLE');
        assert.equal(descriptor.approvedContentSha256, contentHash(version.content));
        const entry = approvedEntry(prepared.buffer, descriptor, version.content);
        assert.equal(entry.name, descriptor.installationDirectory);
        result = { capabilityId: binding.capabilityId, versionId: version.id, name: binding.capability.name,
          installationDirectory: entry.name, approvedContentSha256: descriptor.approvedContentSha256,
          artifactSha256: descriptor.artifactSha256, byteLength: prepared.buffer.length, status: 'PASS' };
        results.set(version.id, result);
      }
      const key = result.installationDirectory.normalize('NFKC').toLowerCase();
      assert.ok(!directories.has(key), `安装目录冲突：${employee.name}`);
      directories.add(key);
    }
    employeeResults.push({ employeeId: employee.id, name: employee.name, skills: directories.size, status: 'PASS' });
  }
  const report = { checkedAt: new Date().toISOString(), preview,
    method: 'Read-only local database; real backend artifacts and unchanged client approvedEntry parser; no installation, conversation or model calls',
    businessAcceptance: 'NOT_RUN', employees: employeeResults, artifacts: [...results.values()],
    summary: { employees: employeeResults.length, artifacts: results.size,
      revisedArtifacts: [...results.values()].filter(r => plan.revisions.some(p => p.capabilityId === r.capabilityId)).length } };
  const directory = resolve(root, 'outputs/market-remediation-2026-10-15', `${Date.now()}-artifacts-${preview ? 'preview' : 'applied'}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report.summary, preview, report: resolve(directory, 'report.json') }));
} finally {
  await prisma.$disconnect();
}

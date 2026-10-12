// Parse checked-in YAML only; never resolve Compose interpolation or load .env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
// Reuse the workspace's installed tooling dependency without adding a package.
const packages = path.join(root, 'node_modules/.pnpm');
const parser = fs.readdirSync(packages).find(name =>
  name.startsWith('js-yaml@4.') && fs.existsSync(path.join(packages, name, 'node_modules/js-yaml')),
);
assert.ok(parser, 'existing js-yaml tooling dependency must be installed');
const yaml = require(path.join(packages, parser, 'node_modules/js-yaml'));
const defaults = {
  MEMBER_CONCURRENCY: 4,
  ENTERPRISE_CONCURRENCY: 32,
  MEMBER_RPM: 120,
  ENTERPRISE_RPM: 600,
  ENTERPRISE_TOKEN_BUDGET: 0,
  DEFAULT_MAX_TOKENS: 4096,
  MAX_REQUEST_BYTES: 4194304,
  JSON_MAX_BYTES: 8388608,
  ERROR_MAX_BYTES: 65536,
  AUTH_TOKEN_MAX_BYTES: 4096,
  AUTH_FAILURE_TOKEN_LIMIT: 120,
  AUTH_FAILURE_SOURCE_LIMIT: 1200,
  AUTH_FAILURE_WINDOW_MS: 60000,
  MODEL_RATE_LIMIT: 60,
  MODEL_RATE_WINDOW_MS: 60000,
};

for (const [file, services] of [
  ['docker-compose.yml', ['sep-backend']],
  ['docker-compose.blue-green.yml', ['blue-backend', 'green-backend']],
]) {
  const compose = yaml.load(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  for (const name of services) {
    const backend = compose.services[name];
    const environment = Array.isArray(backend.environment)
      ? Object.fromEntries(backend.environment.map(entry => {
        const index = entry.indexOf('=');
        return [entry.slice(0, index), entry.slice(index + 1)];
      }))
      : backend.environment;
    for (const [suffix, value] of Object.entries(defaults)) {
      const key = `GATEWAY_${suffix}`;
      assert.equal(environment[key], '${' + key + ':-' + value + '}', `${file}/${name}/${key}`);
    }
    assert.equal(environment.SEP_GATEWAY_DRAIN_TIMEOUT_MS, '${SEP_GATEWAY_DRAIN_TIMEOUT_MS:-}');
    assert.equal(backend.stop_grace_period, '${SEP_STOP_GRACE_SECONDS:-30}s');
    assert.ok(backend.healthcheck.test.join(' ').includes('3001/health'));
  }
}
console.log('sep-compose tests passed (13 defaults, independent original RPM, both production backends/colors)');

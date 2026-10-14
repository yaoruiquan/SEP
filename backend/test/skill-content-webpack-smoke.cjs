const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { TextEncoder } = require('node:util');
const vm = require('node:vm');

// Exercise the real Nest bundle without bootstrapping services or reading app config.
// The bundle is instrumented only in memory; dist/main.js remains ready for startup.
const bundlePath = path.resolve(__dirname, '../dist/main.js');
const source = readFileSync(bundlePath, 'utf8');
const startup = /var __webpack_exports__ = __webpack_require__\(0\);/g;
assert.equal([...source.matchAll(startup)].length, 1, 'Expected one webpack startup entry');
const instrumented = source.replace(startup, `
  var skillModules = Object.entries(__webpack_modules__).filter(([, factory]) =>
    factory.toString().includes('function parseSkillMarkdown('));
  if (skillModules.length !== 1) throw new Error('Expected one bundled skill-content module');
  globalThis.skillContent = __webpack_require__(skillModules[0][0]);
`);
const context = vm.createContext({
  require: createRequire(bundlePath),
  __filename: bundlePath,
  __dirname: path.dirname(bundlePath),
  Buffer,
  TextEncoder,
});
vm.runInContext(instrumented, context, { filename: bundlePath, timeout: 5000 });
const { parseSkillMarkdown, prepareSkillMarkdown } = context.skillContent;
assert.equal(typeof parseSkillMarkdown, 'function', 'Bundled module must initialize');

const content = '\ufeff\r\n---\r\nname: 电商日报\r\ndescription: 2026-10-14\r\nmetadata:\r\n  date: 2026-10-14\r\n  leading: 010\r\n  octal: 0o10\r\n  exponent: 1e3\r\n  bool: true\r\n  yes: yes\r\n  time: 1:30\r\n---\r\n日报正文';
const parsed = parseSkillMarkdown(content);
assert.deepEqual(JSON.parse(JSON.stringify(parsed.data)), {
  name: '电商日报',
  description: '2026-10-14',
  metadata: { date: '2026-10-14', leading: 10, octal: 8, exponent: 1000, bool: true, yes: 'yes', time: '1:30' },
});
const prepared = prepareSkillMarkdown(content, 'fallback');
assert.equal(prepared.status, 'AVAILABLE');
assert.equal(prepared.content, content, 'Approved bytes must remain unchanged');
assert.equal(prepared.body, '日报正文');
assert.equal(prepareSkillMarkdown('正文', '电商日报').status, 'AVAILABLE');
for (const invalid of [
  '---\nname: a\nname: b\n---\nbody',
  '---\nname: !!js/function x\n---\nbody',
]) {
  assert.equal(prepareSkillMarkdown(invalid, 'fallback').reason, 'INVALID_ENTRY');
}
assert.equal(prepareSkillMarkdown(content + '\nRead references/check.md', 'fallback').reason, 'PACKAGE_REQUIRED');
console.log('PASS: dist/main.js skill-content initialization, CORE YAML semantics, source preservation and rejection boundaries');

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const snapshot = JSON.parse(await readFile(new URL('./snapshot.json', import.meta.url), 'utf8'));
const endpoint = 'http://localhost:3001/api/market/employees';
const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
assert.equal(response.status, 200);
const publicEmployees = await response.json();
assert.ok(Array.isArray(publicEmployees));
const ids = new Set(publicEmployees.map(employee => employee.id));
assert.equal(ids.size, snapshot.employees.length);
const comparisons = snapshot.employees.map(employee => {
  const publicEmployee = publicEmployees.find(item => item.id === employee.id);
  assert.ok(publicEmployee, employee.id);
  assert.equal(publicEmployee.name, employee.name);
  assert.equal(publicEmployee.description, employee.description);
  assert.equal(publicEmployee._count.subscriptions, employee.subscriptions);
  return { id: employee.id, name: employee.name, description: employee.description,
    subscriptions: employee.subscriptions, matched: true };
});
const report = { checkedAt: new Date().toISOString(), endpoint, method: '无认证只读 GET；仅保存市场身份及订阅计数白名单',
  status: response.status, count: comparisons.length, allMatched: true, employees: comparisons };
await writeFile(new URL('./public-market-check.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ publicEmployees: report.count, allMatched: report.allMatched }));

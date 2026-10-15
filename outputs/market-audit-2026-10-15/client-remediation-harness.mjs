import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, '../sep-client/package.json'));
const { _electron } = require('playwright-core');
const profile = (await readFile(resolve(root, 'outputs/client-ecommerce-e2e-2026-10-14/profile-path.txt'), 'utf8')).trim();
const output = resolve(root, 'outputs/market-remediation-2026-10-15/client-e2e');
await mkdir(output, { recursive: true, mode: 0o700 });
const application = await _electron.launch({ executablePath: require('electron'), cwd: resolve(root, '../sep-client'),
  args: [resolve(root, 'outputs/client-ecommerce-e2e-2026-10-14/electron-entry.mjs')],
  env: { ...process.env, SEP_E2E_PROFILE: profile, SEP_BASE_URL: 'http://127.0.0.1:3001/api',
    SEP_ASSET_BASE_URL: 'http://localhost:3000', SEP_WEB_ORIGIN: 'http://localhost:3000', SEP_WEB_BASE_URL: 'http://localhost:3000',
    SEP_GATEWAY_URL: 'http://127.0.0.1:3001/api/gateway/v1', SEP_PLAYWRIGHT_MCP: '0' }, timeout: 30_000 });
try {
  const page = await application.firstWindow();
  page.setDefaultTimeout(15_000);
  await page.waitForFunction(() => Boolean(window.electronAPI));
  const ipc = (method, ...args) => page.evaluate(async ({ method, args }) => window.electronAPI[method](...args), { method, args });
  const shot = name => page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  console.log('READY ' + JSON.stringify({ body: (await page.locator('body').innerText()).slice(0, 1800) }));
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    if (line.trim() === 'exit') break;
    try { console.log('RESULT ' + JSON.stringify(await eval(`(async()=>{${line}})()`) ?? null)); }
    catch (error) { console.log('ERROR ' + JSON.stringify({ message: error.message })); }
  }
} finally {
  await application.close();
}

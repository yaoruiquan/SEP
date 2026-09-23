import { test, expect } from '@playwright/test';

/**
 * 运营端核心流程 E2E 测试
 *
 * 场景：运营登录 → 查看能力列表 → 查看员工列表 → 查看企业列表 → 查看统计数据
 *
 * 前置条件：
 * - 后端服务运行在 http://localhost:3001
 * - 前端服务运行在 http://localhost:3001
 * - 数据库已有平台管理员账号（通过 seed 初始化）
 */

test.describe.serial('运营端核心流程', () => {
  const adminEmail = 'admin@sep.local';
  const adminPassword = 'Demo123456';
  const authStatePath = '/tmp/e2e-admin-auth-state.json';

  test.beforeAll(async () => {
    // 验证后端服务可用
    const response = await fetch('http://localhost:3001/api/health');
    if (!response.ok) {
      throw new Error('后端服务未运行，请先启动: pnpm dev:backend');
    }
  });

  test('1. 运营管理员登录', async ({ page, context }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/, { timeout: 10000 });

    // 验证运营后台核心元素
    await expect(page.getByRole('link', { name: '仪表盘' })).toBeVisible({ timeout: 5000 });

    // 保存认证状态供后续测试使用
    await context.storageState({ path: authStatePath });
  });

  test('2. 查看能力列表', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authStatePath });
    const page = await context.newPage();

    await page.goto('/admin/capabilities');

    // Wait for auth refresh and page to fully load
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // If redirected to login, auth refresh failed
    await expect(page).not.toHaveURL(/\/login/, { timeout: 2000 });

    // Verify page loaded with content
    await expect(page.getByRole('heading', { name: '能力管理' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("新建能力")')).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test('3. 查看员工列表', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authStatePath });
    const page = await context.newPage();

    await page.goto('/admin/employees');

    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await expect(page).not.toHaveURL(/\/login/, { timeout: 2000 });

    // Verify page loaded
    await expect(page.getByRole('heading', { name: '员工管理' })).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test('4. 查看企业列表', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authStatePath });
    const page = await context.newPage();

    await page.goto('/admin/enterprises');

    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await expect(page).not.toHaveURL(/\/login/, { timeout: 2000 });

    // Verify page loaded
    await expect(page.getByRole('heading', { name: '企业管理' })).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('5. 查看平台统计数据', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authStatePath });
    const page = await context.newPage();

    await page.goto('/admin');

    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await expect(page).not.toHaveURL(/\/login/, { timeout: 2000 });

    // Verify dashboard loaded
    await expect(page.getByRole('heading', { name: '运营仪表盘' })).toBeVisible({ timeout: 10000 });

    await context.close();
  });
});

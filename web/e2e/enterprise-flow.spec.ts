import { test, expect } from '@playwright/test';

/**
 * 企业端核心流程 E2E 测试
 *
 * 场景：企业注册 → 登录 → 订阅硅基员工 → 发起对话
 *
 * 前置条件：
 * - 后端服务运行在 http://localhost:4000
 * - 前端服务运行在 http://localhost:3000
 * - 数据库已初始化（pnpm db:migrate）
 * - Redis 服务正常运行
 */

test.describe('企业端核心流程', () => {
  const testEmail = `e2e-test-${Date.now()}@example.com`;
  const testPassword = 'Test123456!';
  const enterpriseName = `E2E测试企业${Date.now()}`;

  test.beforeAll(async () => {
    // 验证后端服务可用
    const response = await fetch('http://localhost:4000/api/health');
    if (!response.ok) {
      throw new Error('后端服务未运行，请先启动: pnpm dev:backend');
    }
  });

  test('1. 企业注册流程', async ({ page }) => {
    await page.goto('/register');

    // 填写注册表单
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);
    await page.fill('input[name="name"]', '测试用户');
    await page.fill('input[name="enterpriseName"]', enterpriseName);

    // 提交注册
    await page.click('button[type="submit"]');

    // 验证跳转到登录页或 Dashboard
    await page.waitForURL(/\/(login|dashboard)/, { timeout: 10000 });

    // 如果跳转到登录页，说明注册成功
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/(login|dashboard)/);
  });

  test('2. 企业登录流程', async ({ page }) => {
    await page.goto('/login');

    // 填写登录表单
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);

    // 提交登录
    await page.click('button[type="submit"]');

    // 验证跳转到 Dashboard
    await page.waitForURL('/dashboard', { timeout: 10000 });

    // 验证 Dashboard 核心元素存在
    await expect(page.getByText('企业概览')).toBeVisible({ timeout: 5000 });
  });

  test('3. 浏览员工市场', async ({ page }) => {
    // 先登录
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });

    // 进入员工市场
    await page.goto('/employees');

    // 验证页面加载
    await expect(page.getByText('硅基员工市场')).toBeVisible({ timeout: 5000 });

    // 验证至少有一个员工卡片
    const employeeCards = page.locator('[data-testid="employee-card"]');
    await expect(employeeCards.first()).toBeVisible({ timeout: 10000 });
  });

  test('4. 订阅硅基员工', async ({ page }) => {
    // 先登录
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });

    // 进入员工市场
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');

    // 点击第一个员工的"立即订阅"按钮
    const subscribeButton = page.locator('button:has-text("立即订阅")').first();
    await subscribeButton.click();

    // 等待订阅对话框
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // 填写订阅信息
    const subscriptionName = `测试订阅-${Date.now()}`;
    await page.fill('input[placeholder*="名称"]', subscriptionName);

    // 确认订阅
    await page.click('button:has-text("确认订阅")');

    // 等待成功提示或跳转
    await page.waitForTimeout(2000);

    // 验证订阅成功（应该在"我的员工"页面能看到）
    await page.goto('/my-employees');
    await expect(page.getByText(subscriptionName)).toBeVisible({ timeout: 10000 });
  });

  test('5. 发起对话', async ({ page }) => {
    // 先登录
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 10000 });

    // 进入"我的员工"
    await page.goto('/my-employees');
    await page.waitForLoadState('networkidle');

    // 点击第一个员工进入详情页
    const employeeCard = page.locator('[data-testid="employee-card"]').first();
    await employeeCard.click();

    // 等待详情页加载
    await page.waitForURL(/\/my-employees\//, { timeout: 10000 });

    // 点击"开始对话"按钮
    const chatButton = page.locator('button:has-text("开始对话")');
    await chatButton.click();

    // 验证对话界面加载
    await expect(page.locator('[data-testid="chat-window"]')).toBeVisible({ timeout: 5000 });

    // 发送测试消息
    const messageInput = page.locator('textarea[placeholder*="输入消息"]');
    await messageInput.fill('你好，这是一个E2E测试消息');
    await page.click('button[type="submit"]');

    // 验证消息已发送（应该在对话框中看到）
    await expect(page.getByText('你好，这是一个E2E测试消息')).toBeVisible({ timeout: 5000 });

    // 等待AI回复（最多30秒）
    const aiReply = page.locator('[data-role="assistant"]').first();
    await expect(aiReply).toBeVisible({ timeout: 30000 });
  });
});

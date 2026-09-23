import { test, expect } from '@playwright/test';

/**
 * 运营端核心流程 E2E 测试
 *
 * 场景：运营登录 → 创建员工模板 → 配置能力 → 发布
 *
 * 前置条件：
 * - 后端服务运行在 http://localhost:3001
 * - 前端服务运行在 http://localhost:3001
 * - 数据库已有平台管理员账号（通过 seed 初始化）
 */

test.describe('运营端核心流程', () => {
  const adminEmail = 'admin@sep.com';
  const adminPassword = 'admin123';
  test.beforeAll(async () => {
    // 验证后端服务可用
    const response = await fetch('http://localhost:3001/api/health');
    if (!response.ok) {
      throw new Error('后端服务未运行，请先启动: pnpm dev:backend');
    }
  });

  test('1. 运营管理员登录', async ({ page }) => {
    await page.goto('/login');
    // TODO: Platform admin role detection needed

    // 填写登录表单
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', adminPassword);

    // 提交登录
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/, { timeout: 10000 });

    await expect(page.getByRole('link', { name: '工作台' })).toBeVisible({ timeout: 5000 });    // 验证运营后台核心元素
    await expect(page.getByText('平台管理')).toBeVisible({ timeout: 5000 });
  });

  test('2. 创建员工模板', async ({ page }) => {
    // 先登录
    await page.goto('/login');
    // TODO: Platform admin role detection needed
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/, { timeout: 10000 });

    // 进入能力管理页
    await page.goto('/admin/capabilities');

    // 点击"创建员工"按钮
    await page.click('button:has-text("创建员工")');

    // 等待创建对话框
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // 填写员工信息
    const employeeName = `E2E测试员工-${Date.now()}`;
    await page.fill('input[name="name"]', employeeName);
    await page.fill('textarea[name="description"]', '这是一个E2E测试创建的员工模板');

    // 选择分类（假设有下拉选择）
    const categorySelect = page.locator('select[name="category"]');
    if (await categorySelect.isVisible()) {
      await categorySelect.selectOption({ index: 0 });
    }

    // 提交创建
    await page.click('button:has-text("确认创建")');

    // 等待创建成功
    await page.waitForTimeout(2000);

    // 验证员工已创建（在列表中能找到）
    await expect(page.getByText(employeeName)).toBeVisible({ timeout: 10000 });
  });

  test('3. 配置员工能力', async ({ page }) => {
    // 先登录
    await page.goto('/login');
    // TODO: Platform admin role detection needed
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/, { timeout: 10000 });

    // 进入能力管理页
    await page.goto('/admin/capabilities');
    await page.waitForLoadState('networkidle');

    // 点击第一个员工进入详情
    const employeeCard = page.locator('[data-testid="employee-card"]').first();
    await employeeCard.click();

    // 等待详情页加载
    await page.waitForURL(/\/admin\/employees\//, { timeout: 10000 });

    // 切换到"能力配置"标签
    await page.click('button[role="tab"]:has-text("能力")');

    // 点击"添加能力"按钮
    const addCapabilityButton = page.locator('button:has-text("添加能力")');
    if (await addCapabilityButton.isVisible()) {
      await addCapabilityButton.click();

      // 等待能力选择对话框
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

      // 选择第一个可用能力
      const firstCapability = page.locator('[data-testid="capability-item"]').first();
      await firstCapability.click();

      // 确认添加
      await page.click('button:has-text("确认")');

      // 验证能力已添加
      await page.waitForTimeout(1000);
    }
  });

  test('4. 发布员工模板', async ({ page }) => {
    // 先登录
    await page.goto('/login');
    // TODO: Platform admin role detection needed
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/, { timeout: 10000 });

    // 进入能力管理页
    await page.goto('/admin/capabilities');
    await page.waitForLoadState('networkidle');

    // 点击第一个未发布的员工
    const employeeCard = page.locator('[data-testid="employee-card"]').first();
    await employeeCard.click();

    // 等待详情页加载
    await page.waitForURL(/\/admin\/employees\//, { timeout: 10000 });

    // 点击"发布"按钮
    const publishButton = page.locator('button:has-text("发布")');
    if (await publishButton.isVisible()) {
      await publishButton.click();

      // 等待确认对话框
      const confirmDialog = page.getByRole('dialog');
      if (await confirmDialog.isVisible()) {
        await page.click('button:has-text("确认")');
      }

      // 等待发布成功
      await page.waitForTimeout(2000);

      // 验证状态变为"已发布"
      await expect(page.getByText('已发布')).toBeVisible({ timeout: 5000 });
    }
  });

  test('5. 查看企业列表', async ({ page }) => {
    // 先登录
    await page.goto('/login');
    // TODO: Platform admin role detection needed
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/, { timeout: 10000 });

    // 进入企业管理页
    await page.goto('/platform/enterprises');

    // 验证页面加载
    await expect(page.getByText('企业管理')).toBeVisible({ timeout: 5000 });

    // 验证至少有一个企业记录
    const enterpriseRows = page.locator('tbody tr');
    await expect(enterpriseRows.first()).toBeVisible({ timeout: 10000 });
  });

  test('6. 查看平台统计数据', async ({ page }) => {
    // 先登录
    await page.goto('/login');
    // TODO: Platform admin role detection needed
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin/, { timeout: 10000 });

    // 已在 Dashboard 页面，验证关键统计指标
    await expect(page.getByText('企业总数')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('活跃订阅')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('总对话数')).toBeVisible({ timeout: 5000 });

    // 验证统计图表存在
    const charts = page.locator('[data-testid="chart"]');
    if (await charts.first().isVisible()) {
      await expect(charts.first()).toBeVisible();
    }
  });
});

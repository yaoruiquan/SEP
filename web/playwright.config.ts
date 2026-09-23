import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 测试配置
 *
 * 测试覆盖：
 * 1. 企业端：注册 → 登录 → 订阅员工 → 对话
 * 2. 运营端：创建员工模板 → 发布
 * 3. 客户端SDK：设备登录 → 模型网关调用
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // 顺序执行（测试间有状态依赖）
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // 单线程执行（避免数据库并发冲突）
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 启动本地服务器（仅在未运行时）
  webServer: process.env.SKIP_WEB_SERVER ? undefined : {
    command: 'pnpm dev',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});

/**
 * E2E 测试工具函数
 *
 * 提供测试中常用的辅助方法
 */

import { Page } from '@playwright/test';

/**
 * 企业端登录辅助函数
 */
export async function enterpriseLogin(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/dashboard', { timeout: 10000 });
}

/**
 * 运营端登录辅助函数
 */
export async function platformLogin(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto('/platform/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/platform/dashboard', { timeout: 10000 });
}

/**
 * 等待 API 响应
 */
export async function waitForApiResponse(
  page: Page,
  urlPattern: string | RegExp,
  timeout = 10000
): Promise<any> {
  const response = await page.waitForResponse(
    (resp) => {
      const url = resp.url();
      if (typeof urlPattern === 'string') {
        return url.includes(urlPattern);
      }
      return urlPattern.test(url);
    },
    { timeout }
  );
  return response.json();
}

/**
 * 生成唯一测试数据标识
 */
export function generateTestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 清理测试数据（通过 API）
 */
export async function cleanupTestData(
  apiBaseUrl: string,
  token: string,
  resourceType: 'enterprise' | 'subscription' | 'conversation',
  resourceId: string
): Promise<void> {
  const endpoints: Record<string, string> = {
    enterprise: `/api/enterprises/${resourceId}`,
    subscription: `/api/subscriptions/${resourceId}`,
    conversation: `/api/conversations/${resourceId}`,
  };

  await fetch(`${apiBaseUrl}${endpoints[resourceType]}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * 验证错误提示显示
 */
export async function expectErrorMessage(
  page: Page,
  message: string | RegExp,
  timeout = 5000
): Promise<void> {
  const errorElement = page.locator('[role="alert"], .error-message, .toast-error');
  await errorElement.waitFor({ state: 'visible', timeout });

  if (typeof message === 'string') {
    await errorElement.filter({ hasText: message }).first().waitFor({ state: 'visible' });
  } else {
    const text = await errorElement.first().textContent();
    if (!text || !message.test(text)) {
      throw new Error(`Expected error message to match ${message}, got: ${text}`);
    }
  }
}

/**
 * 验证成功提示显示
 */
export async function expectSuccessMessage(
  page: Page,
  message: string | RegExp,
  timeout = 5000
): Promise<void> {
  const successElement = page.locator('[role="status"], .success-message, .toast-success');
  await successElement.waitFor({ state: 'visible', timeout });

  if (typeof message === 'string') {
    await successElement.filter({ hasText: message }).first().waitFor({ state: 'visible' });
  } else {
    const text = await successElement.first().textContent();
    if (!text || !message.test(text)) {
      throw new Error(`Expected success message to match ${message}, got: ${text}`);
    }
  }
}

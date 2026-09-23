import { test, expect } from '@playwright/test';

/**
 * 客户端 SDK 核心流程 E2E 测试
 *
 * 场景：设备登录 → 模型网关调用 → 计费验证
 *
 * 注意：此测试通过 API 直接测试客户端 SDK 流程
 * 前置条件：
 * - 后端服务运行在 http://localhost:3001
 * - 数据库已有企业和订阅数据（通过企业端流程创建）
 */

test.describe('客户端 SDK 核心流程', () => {
  let enterpriseId: string;
  let apiKey: string;
  let deviceId: string;
  let deviceToken: string;

  test.beforeAll(async () => {
    // 验证后端服务可用
    const response = await fetch('http://localhost:3001/api/health');
    if (!response.ok) {
      throw new Error('后端服务未运行，请先启动: pnpm dev:backend');
    }
  });

  test('1. 获取企业 API 密钥', async ({ request }) => {
    // 企业管理员登录
    const loginResponse = await request.post('http://localhost:3001/api/auth/login', {
      data: {
        email: 'boss@acme.local',
        password: 'Demo123456',
      },
    });
    expect(loginResponse.ok()).toBeTruthy();

    const loginData = await loginResponse.json();
    const token = loginData.token;
    enterpriseId = loginData.enterprise.id;

    // 创建 API 密钥
    const keyResponse = await request.post(
      `http://localhost:3001/api/enterprise/api-keys`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        data: {
          name: `E2E测试密钥-${Date.now()}`,
          scopes: ["chat:read"],
        },
      }
    );

    if (keyResponse.ok()) {
      const keyData = await keyResponse.json();
      apiKey = keyData.key;
      expect(apiKey).toMatch(/^sk-ent-/);
    } else {
      // 如果创建失败，尝试获取已有密钥
      const listResponse = await request.get(
        `http://localhost:3001/api/enterprise/api-keys`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      expect(listResponse.ok()).toBeTruthy();
      const listData = await listResponse.json();
      expect(listData.data.length).toBeGreaterThan(0);
      // 注意：列表返回的是 keyPrefix，不是完整密钥，需要用新创建的
      test.skip();
    }
  });

  test('2. 设备登录', async ({ request }) => {
    test.skip(!apiKey, '需要先获取 API 密钥');

    deviceId = `e2e-device-${Date.now()}`;

    const response = await request.post('http://localhost:3001/api/client/auth/device-login', {
      headers: {
        'x-api-key': apiKey,
      },
      data: {
        deviceId,
        deviceName: 'E2E测试设备',
        deviceType: 'web',
      },
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    deviceToken = data.data.token;
    expect(deviceToken).toBeTruthy();
    expect(data.data.deviceId).toBe(deviceId);
  });

  test('3. 模型网关 - Chat Completion', async ({ request }) => {
    test.skip(!deviceToken, '需要先完成设备登录');

    const response = await request.post('http://localhost:3001/api/client/gateway/chat/completions', {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: 'Hello, this is an E2E test message.',
          },
        ],
        temperature: 0.7,
        max_tokens: 100,
      },
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.choices).toBeDefined();
    expect(data.choices[0].message.content).toBeTruthy();
    expect(data.usage).toBeDefined();
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  });

  test('4. 模型网关 - 流式响应', async ({ request }) => {
    test.skip(!deviceToken, '需要先完成设备登录');

    const response = await request.post('http://localhost:3001/api/client/gateway/chat/completions', {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: 'Count from 1 to 5.',
          },
        ],
        stream: true,
      },
    });

    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/event-stream');

    // 读取流式响应
    const body = await response.body();
    const text = body.toString();

    // 验证 SSE 格式
    expect(text).toContain('data: ');
    expect(text).toContain('[DONE]');
  });

  test('5. 查询余额和用量', async ({ request }) => {
    test.skip(!deviceToken, '需要先完成设备登录');

    // 查询计算配额余额
    const balanceResponse = await request.get('http://localhost:3001/api/client/compute/balance', {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
      },
    });

    expect(balanceResponse.ok()).toBeTruthy();

    const balanceData = await balanceResponse.json();
    expect(balanceData.data.balance).toBeDefined();
    expect(typeof balanceData.data.balance).toBe('string'); // CNY 金额字符串

    // 查询用量记录
    const usageResponse = await request.get('http://localhost:3001/api/client/compute/usage?days=7', {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
      },
    });

    expect(usageResponse.ok()).toBeTruthy();

    const usageData = await usageResponse.json();
    expect(Array.isArray(usageData.data)).toBeTruthy();
  });

  test('6. 设备登出', async ({ request }) => {
    test.skip(!deviceToken, '需要先完成设备登录');

    const response = await request.post('http://localhost:3001/api/client/auth/logout', {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();

    // 验证 token 已失效
    const verifyResponse = await request.get('http://localhost:3001/api/client/compute/balance', {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
      },
    });

    expect(verifyResponse.status()).toBe(401);
  });
});

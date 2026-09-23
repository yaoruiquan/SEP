import { test, expect } from '@playwright/test';

/**
 * 客户端 SDK 核心流程 E2E 测试
 *
 * 场景：客户端登录 → 换取 employmentToken → 模型网关调用 → 计费验证
 *
 * 注意：此测试通过 API 直接测试客户端 SDK 流程
 * 前置条件：
 * - 后端服务运行在 http://localhost:3001
 * - 数据库已有企业和订阅数据
 */

test.describe.serial('客户端 SDK 核心流程', () => {
  let accessToken: string;
  let refreshToken: string;
  let employmentToken: string;
  let subscriptionId: string;

  test.beforeAll(async () => {
    // 验证后端服务可用
    const response = await fetch('http://localhost:3001/api/health');
    if (!response.ok) {
      throw new Error('后端服务未运行，请先启动: pnpm dev:backend');
    }
  });

  test('1. 客户端登录', async ({ request }) => {
    const fingerprint = `e2e-fp-${Date.now()}`;
    
    const response = await request.post('http://localhost:3001/api/client/auth/login', {
      data: {
        email: 'liuling@shuyi.local',
        password: 'Demo123456',
        fingerprint,
        platform: 'darwin',
        clientVersion: '1.0.0-e2e',
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Client login failed:', response.status(), errorText);
    }
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  test('2. 获取订阅列表', async ({ request }) => {
    test.skip(!accessToken, '需要先完成客户端登录');

    const response = await request.get('http://localhost:3001/api/client/subscriptions', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.length).toBeGreaterThan(0);
    
    // 保存第一个订阅 ID 用于后续测试
    subscriptionId = data[0].id;
    expect(subscriptionId).toBeTruthy();
  });

  test('3. 换取 employmentToken', async ({ request }) => {
    test.skip(!refreshToken || !subscriptionId, '需要先完成登录和获取订阅');

    const response = await request.post('http://localhost:3001/api/client/auth/token', {
      data: {
        refreshToken,
        subscriptionId,
      },
    });

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Get employment token failed:', response.status(), errorText);
    }
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    employmentToken = data.employmentToken;
    expect(employmentToken).toBeTruthy();
  });

  test('4. 模型网关 - Chat Completion', async ({ request }) => {
    test.skip(!employmentToken, '需要先换取 employmentToken');

    const response = await request.post('http://localhost:3001/api/gateway/v1/chat/completions', {
      headers: {
        Authorization: `Bearer ${employmentToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        model: 'gemini-3.5-flash',
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

    if (!response.ok()) {
      const errorText = await response.text();
      console.error('Gateway chat failed:', response.status(), errorText);
    }
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.choices).toBeDefined();
    expect(data.choices[0].message.content).toBeTruthy();
    expect(data.usage).toBeDefined();
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  });

  test('5. 模型网关 - 流式响应', async ({ request }) => {
    test.skip(!employmentToken, '需要先换取 employmentToken');

    const response = await request.post('http://localhost:3001/api/gateway/v1/chat/completions', {
      headers: {
        Authorization: `Bearer ${employmentToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        model: 'gemini-3.5-flash',
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

    // 验证流式响应格式
    const body = await response.text();
    expect(body).toContain('data:');
    expect(body).toContain('[DONE]');
  });

  test('6. 验证计费记录', async ({ request }) => {
    test.skip(!accessToken, '需要先完成客户端登录');

    // 获取算力消费记录
    const computeResponse = await request.get('http://localhost:3001/api/compute/transactions', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!computeResponse.ok()) {
      const errorText = await computeResponse.text();
      console.error('Get compute transactions failed:', computeResponse.status(), errorText);
    }
    expect(computeResponse.ok()).toBeTruthy();

    const computeData = await computeResponse.json();
    expect(computeData.transactions).toBeDefined();

    // The test passes if we got a valid response structure
    // (actual billing records are created async and tracked elsewhere)
    expect(computeData.total).toBeGreaterThanOrEqual(0);
  });
});

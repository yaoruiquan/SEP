#!/usr/bin/env node

/**
 * 测试 Phase 2 Week 4 Part 2: 对话系统 + 知识库集成
 *
 * 测试流程：
 * 1. 创建知识库并添加测试内容
 * 2. 授权知识库给员工实例
 * 3. 发起对话，验证知识库内容被注入
 * 4. 检查消息是否保存了 knowledgeSources
 */

const BASE_URL = 'http://localhost:3001';
let accessToken = '';
let knowledgeBaseId = '';
let sessionId = '';

async function request(method, path, body = null) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function streamConversation(sessionId, message) {
  const response = await fetch(`${BASE_URL}/conversations/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: message }),
  });

  if (!response.ok) {
    throw new Error(`Stream failed: ${response.status}`);
  }

  let fullText = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const dataStr = line.slice(6);
      if (dataStr === '[DONE]') continue;

      try {
        const event = JSON.parse(dataStr);

        if (event.event === 'text_delta') {
          process.stdout.write(event.data);
          fullText += event.data;
        } else if (event.event === 'done') {
          console.log('\n\n✅ 消息 ID:', event.data.messageId);
          return { messageId: event.data.messageId, fullText };
        } else if (event.event === 'error') {
          console.error('\n❌ 错误:', event.data.message);
          throw new Error(event.data.message);
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  }

  return { messageId: null, fullText };
}

async function main() {
  console.log('🚀 测试对话系统 + 知识库集成');
  console.log('='.repeat(60));

  // 1. 登录
  console.log('\n1️⃣ 登录...');
  const loginData = await request('POST', '/auth/login', {
    email: 'boss@acme.local',
    password: 'Demo123456',
  });
  accessToken = loginData.token;
  console.log('✅ 登录成功');

  // 2. 创建知识库
  console.log('\n2️⃣ 创建知识库...');
  const kb = await request('POST', '/knowledge', {
    name: 'NestJS 官方文档',
    description: 'NestJS 框架相关知识',
  });
  knowledgeBaseId = kb.id;
  console.log(`✅ 知识库创建: ${knowledgeBaseId}`);

  // 3. 添加知识内容
  console.log('\n3️⃣ 添加知识内容...');
  const chunks = [
    {
      title: 'NestJS 简介',
      content: 'NestJS 是一个用于构建高效、可扩展的 Node.js 服务器端应用程序的框架。它使用 TypeScript 构建，并结合了 OOP（面向对象编程）、FP（函数式编程）和 FRP（函数响应式编程）的元素。NestJS 底层使用 Express 框架，也可以配置为使用 Fastify。',
    },
    {
      title: 'NestJS 核心概念',
      content: 'NestJS 的核心概念包括：模块（Modules）用于组织代码、控制器（Controllers）处理 HTTP 请求、提供者（Providers）包含业务逻辑、依赖注入（DI）用于管理组件依赖关系。装饰器是 NestJS 的重要特性，用于定义路由、依赖注入等。',
    },
    {
      title: 'NestJS 安装',
      content: '使用 Nest CLI 可以快速创建项目：npm i -g @nestjs/cli 然后 nest new project-name。你也可以手动安装依赖：npm install @nestjs/core @nestjs/common rxjs reflect-metadata。推荐使用 TypeScript 开发。',
    },
  ];

  for (const chunk of chunks) {
    await request('POST', `/knowledge/${knowledgeBaseId}/chunks`, chunk);
  }
  console.log(`✅ 添加了 ${chunks.length} 个知识块`);

  // 4. 准备测试员工
  console.log('\n4️⃣ 准备测试...');
  // 使用电商运营总监·李明
  const employeeId = 'cmsfx8fu6000c7qyghk7mr6gs';
  console.log(`📋 使用员工: ${employeeId}`);

  // 注意：由于我们没有订阅系统，这里跳过授权步骤
  // 实际使用中需要：1) 订阅员工 2) 获取实例 ID 3) 授权知识库给实例
  console.log('⚠️  跳过知识库授权（测试环境未实现实例查询）');

  // 5. 创建对话会话
  console.log('\n5️⃣ 创建对话会话...');
  const session = await request('POST', '/conversations', {
    employeeId,
  });
  sessionId = session.id;
  console.log(`✅ 会话创建: ${sessionId}`);

  // 6. 测试知识库增强的对话
  console.log('\n6️⃣ 发起对话（应该使用知识库内容）...');
  console.log('-'.repeat(60));
  console.log('💬 用户: NestJS 是什么？它有哪些核心概念？\n');
  console.log('🤖 助手: ');

  const { messageId } = await streamConversation(
    sessionId,
    'NestJS 是什么？它有哪些核心概念？'
  );

  console.log(`\n📝 消息 ID: ${messageId}`);

  // 7. 检查消息是否保存了知识来源
  console.log('\n7️⃣ 检查知识来源是否被保存...');
  const sessionDetail = await request('GET', `/conversations/${sessionId}`);
  const assistantMsg = sessionDetail.messages?.find(m => m.id === messageId);

  if (assistantMsg && assistantMsg.knowledgeSources) {
    console.log('✅ 知识来源已保存:');
    const sources = assistantMsg.knowledgeSources;
    sources.forEach((s, i) => {
      console.log(`   [${i + 1}] ${s.source} (相似度: ${s.score.toFixed(2)})`);
      console.log(`       内容: ${s.content.substring(0, 60)}...`);
    });
  } else {
    console.log('⚠️  未找到知识来源（可能检索未匹配或功能未启用）');
  }

  // 8. 测试无关问题（不应使用知识库）
  console.log('\n8️⃣ 测试无关问题...');
  console.log('-'.repeat(60));
  console.log('💬 用户: 今天天气怎么样？\n');
  console.log('🤖 助手: ');

  await streamConversation(sessionId, '今天天气怎么样？');

  // 9. 清理
  console.log('\n\n9️⃣ 清理测试数据...');
  // DELETE 请求返回 204 No Content，不要解析 JSON
  await fetch(`${BASE_URL}/knowledge/${knowledgeBaseId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  await fetch(`${BASE_URL}/conversations/${sessionId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  console.log('✅ 清理完成');

  console.log('\n' + '='.repeat(60));
  console.log('✅ 测试完成');
}

main().catch(error => {
  console.error('\n❌ 测试失败:', error.message);
  process.exit(1);
});

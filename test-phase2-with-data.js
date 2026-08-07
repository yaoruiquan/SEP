#!/usr/bin/env node

/**
 * 创建测试数据并测试搜索功能
 */

const BASE_URL = 'http://localhost:3001';
let accessToken = '';
let knowledgeBaseId = '';

async function request(method, path, body = null, isFormData = false) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
  };

  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json';
  }

  const options = { method, headers };
  if (body) {
    options.body = isFormData ? body : JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  console.log('🚀 创建测试数据并验证搜索');
  console.log('='.repeat(60));

  // 1. 登录
  console.log('\n1. 登录...');
  const loginData = await request('POST', '/auth/login', {
    email: 'boss@acme.local',
    password: 'Demo123456',
  });
  accessToken = loginData.token;
  console.log('✅ 登录成功');

  // 2. 创建知识库
  console.log('\n2. 创建知识库...');
  const kb = await request('POST', '/knowledge', {
    name: '测试知识库 RAG',
    description: '用于测试 RAG 检索功能',
  });
  knowledgeBaseId = kb.id;
  console.log(`✅ 知识库创建成功: ${knowledgeBaseId}`);

  // 3. 创建文本块
  console.log('\n3. 创建测试文本块...');
  const chunks = [
    {
      title: 'NestJS 框架介绍',
      content: 'NestJS 是一个用于构建高效、可扩展的 Node.js 服务器端应用程序的框架。它使用 TypeScript 构建，并结合了 OOP、FP 和 FRP 的元素。',
      tags: ['NestJS', '框架'],
    },
    {
      title: '系统架构设计',
      content: '硅基人才平台采用前后端分离架构，后端使用 NestJS + Prisma + PostgreSQL，前端使用 Next.js 15 App Router。',
      tags: ['架构', '系统'],
    },
    {
      title: 'RAG 检索原理',
      content: 'RAG（检索增强生成）通过向量数据库检索相关文档片段，然后将这些片段作为上下文提供给大语言模型，从而提高回答的准确性。',
      tags: ['RAG', '检索'],
    },
  ];

  for (const chunk of chunks) {
    await request('POST', `/knowledge/${knowledgeBaseId}/chunks`, chunk);
  }
  console.log(`✅ 创建了 ${chunks.length} 个文本块`);

  // 4. 测试搜索
  console.log('\n4. 测试搜索功能...');
  console.log('-'.repeat(60));

  const queries = [
    { q: 'NestJS', expect: 'NestJS 框架介绍' },
    { q: '系统架构', expect: '前后端分离' },
    { q: 'RAG', expect: '检索增强生成' },
  ];

  for (const { q, expect } of queries) {
    console.log(`\n查询: "${q}"`);
    const result = await request('POST', '/knowledge/search/by-knowledge-base', {
      query: q,
      knowledgeBaseIds: [knowledgeBaseId],
      topK: 3,
      scoreThreshold: 0.5,
    });

    console.log(`  结果数: ${result.count}`);
    if (result.count > 0) {
      const match = result.results[0];
      console.log(`  ✅ 匹配: ${match.content.substring(0, 50)}...`);
      console.log(`  Score: ${match.score}`);
    } else {
      console.log(`  ❌ 未找到结果`);
    }
  }

  // 5. 清理
  console.log('\n\n5. 清理测试数据...');
  await request('DELETE', `/knowledge/${knowledgeBaseId}`);
  console.log('✅ 测试数据已清理');

  console.log('\n' + '='.repeat(60));
  console.log('✅ 测试完成');
}

main().catch(console.error);

#!/usr/bin/env node

/**
 * Phase 2 简化测试：知识库检索功能
 *
 * 前提条件：
 * 1. 后端已运行 (pnpm dev:backend)
 * 2. 已有知识库和文档数据
 * 3. 已有员工实例并授权知识库
 *
 * 测试内容：
 * 1. 全文搜索（无需 Pinecone/OpenAI）
 * 2. 按知识库 ID 检索
 * 3. 按员工实例检索
 */

const BASE_URL = 'http://localhost:3001';

let accessToken = '';

async function request(method, path, body = null) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const options = {
    method,
    headers,
  };

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

async function login() {
  console.log('🔐 登录...');
  const data = await request('POST', '/auth/login', {
    email: 'boss@acme.local',
    password: 'Demo123456',
  });
  accessToken = data.token;
  console.log('✅ 登录成功\n');
}

async function testSearchByKnowledgeBase() {
  console.log('📝 测试 1: 按知识库 ID 检索');
  console.log('--------------------');

  // 先获取知识库列表
  const kbs = await request('GET', '/knowledge');
  console.log(`找到 ${kbs.length} 个知识库`);

  if (kbs.length === 0) {
    console.log('⚠️  没有知识库，跳过测试');
    return;
  }

  const knowledgeBaseId = kbs[0].id;
  console.log(`使用知识库: ${kbs[0].name} (${knowledgeBaseId})`);

  // 测试检索
  const queries = [
    '系统架构',
    'NestJS',
    'RAG 检索',
    '知识库管理',
  ];

  for (const query of queries) {
    try {
      console.log(`\n查询: "${query}"`);
      const result = await request('POST', '/knowledge/search/by-knowledge-base', {
        query,
        knowledgeBaseIds: [knowledgeBaseId],
        topK: 3,
        scoreThreshold: 0.5,
      });

      console.log(`  结果数: ${result.count}`);

      if (result.count > 0) {
        result.results.forEach((r, i) => {
          console.log(`  ${i + 1}. Score: ${r.score.toFixed(3)}`);
          console.log(`     Source: ${r.source}`);
          console.log(`     Content: ${r.content.substring(0, 80)}...`);
        });
      } else {
        console.log('  ⚠️  无匹配结果');
      }
    } catch (error) {
      console.log(`  ❌ 查询失败: ${error.message}`);
    }
  }

  console.log('\n✅ 测试 1 完成\n');
}

async function testSearchByInstance() {
  console.log('📝 测试 2: 按员工实例检索');
  console.log('--------------------');

  const instanceId = 'cmsgtjz1v00037qv7aeemwsil'; // 运营总监
  console.log(`使用实例 ID: ${instanceId}`);

  const query = '知识库';

  try {
    console.log(`\n查询: "${query}"`);
    const result = await request('POST', '/knowledge/search', {
      query,
      instanceId,
      topK: 5,
      scoreThreshold: 0.5,
    });

    console.log(`  结果数: ${result.count}`);

    if (result.count > 0) {
      result.results.forEach((r, i) => {
        console.log(`  ${i + 1}. Score: ${r.score.toFixed(3)}`);
        console.log(`     KB: ${r.knowledgeBaseId}`);
        console.log(`     Source: ${r.source}`);
        console.log(`     Content: ${r.content.substring(0, 80)}...`);
      });
    } else {
      console.log('  ℹ️  该实例未授权任何知识库，或无匹配结果');
      console.log('  💡 提示: 使用 POST /knowledge/{id}/grants 授权知识库');
    }

    console.log('\n✅ 测试 2 完成\n');
  } catch (error) {
    console.log(`  ❌ 查询失败: ${error.message}\n`);
  }
}

async function checkVectorService() {
  console.log('🔍 检查向量服务配置');
  console.log('--------------------');

  console.log('PINECONE_API_KEY: ' + (process.env.PINECONE_API_KEY ? '✅ 已配置' : '❌ 未配置'));
  console.log('OPENAI_API_KEY: ' + (process.env.OPENAI_API_KEY ? '✅ 已配置' : '❌ 未配置'));

  if (!process.env.PINECONE_API_KEY || !process.env.OPENAI_API_KEY) {
    console.log('\n⚠️  向量服务未配置，将使用全文搜索降级模式');
    console.log('💡 配置方法: 在 .env 中添加 PINECONE_API_KEY 和 OPENAI_API_KEY\n');
  } else {
    console.log('\n✅ 向量服务已配置，将使用语义搜索\n');
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 2 简化测试: 知识库检索');
  console.log('='.repeat(60));
  console.log();

  try {
    await checkVectorService();
    await login();
    await testSearchByKnowledgeBase();
    await testSearchByInstance();

    console.log('='.repeat(60));
    console.log('✅ 所有测试完成');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node

/**
 * Phase 2 Week 4 测试：知识库检索功能
 *
 * 测试流程：
 * 1. 登录获取 token
 * 2. 创建测试知识库
 * 3. 上传测试文档并等待处理完成
 * 4. 创建数字员工实例
 * 5. 授权知识库给实例
 * 6. 测试检索功能（按实例 ID）
 * 7. 测试检索功能（按知识库 ID）
 * 8. 清理测试数据
 */

const BASE_URL = 'http://localhost:3001';

let accessToken = '';
let knowledgeBaseId = '';
let documentId = '';
let instanceId = '';

// ==================== 辅助函数 ====================

async function request(method, path, body = null, isFormData = false) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
  };

  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json';
  }

  const options = {
    method,
    headers,
  };

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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDocumentProcessing(docId, maxWaitSeconds = 60) {
  console.log(`⏳ Waiting for document ${docId} to be processed...`);

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    const doc = await request('GET', `/knowledge/${knowledgeBaseId}/documents/${docId}`);

    console.log(`   Status: ${doc.status}`);

    if (doc.status === 'COMPLETED') {
      console.log('✅ Document processing completed');
      return true;
    }

    if (doc.status === 'FAILED') {
      console.log('❌ Document processing failed');
      return false;
    }

    await sleep(2000); // 每 2 秒检查一次
  }

  console.log('⏰ Timeout waiting for document processing');
  return false;
}

// ==================== 测试步骤 ====================

async function step1_login() {
  console.log('\n📝 Step 1: Login');

  const data = await request('POST', '/auth/login', {
    email: 'boss@acme.local',
    password: 'Demo123456',
  });

  accessToken = data.token;
  console.log('✅ Login successful');
}

async function step2_createKnowledgeBase() {
  console.log('\n📝 Step 2: Create Knowledge Base');

  const data = await request('POST', '/knowledge', {
    name: 'RAG Test KB',
    description: 'Knowledge base for testing RAG search',
  });

  knowledgeBaseId = data.id;
  console.log(`✅ Knowledge base created: ${knowledgeBaseId}`);
}

async function step3_uploadDocument() {
  console.log('\n📝 Step 3: Upload Test Document');

  // 创建测试文档内容
  const testContent = `
# 硅基人才平台技术文档

## 系统架构

硅基人才平台采用前后端分离架构：
- 后端：NestJS + Prisma + PostgreSQL
- 前端：Next.js 15 App Router
- 向量数据库：Pinecone
- 嵌入模型：OpenAI text-embedding-3-small

## 核心功能

### 知识库管理
用户可以创建知识库，上传文档（PDF、Word、TXT、Markdown），系统会自动：
1. 解析文档内容
2. 分块处理（1000字符/块，100字符重叠）
3. 生成向量嵌入
4. 存储到向量数据库

### RAG 检索
支持两种检索模式：
1. 按数字员工实例检索：自动查询该员工授权的所有知识库
2. 按知识库 ID 检索：直接指定知识库列表

检索流程：
1. 用户输入查询
2. 查询向量化
3. 在 Pinecone 中搜索相似向量
4. 返回相关文本块（带相似度分数）

## API 端点

- POST /knowledge/search - 按实例检索
- POST /knowledge/search/by-knowledge-base - 按知识库检索
`;

  const formData = new FormData();
  const blob = new Blob([testContent], { type: 'text/markdown' });
  formData.append('file', blob, 'test-doc.md');

  const data = await request(
    'POST',
    `/knowledge/${knowledgeBaseId}/documents/upload`,
    formData,
    true
  );

  documentId = data.id;
  console.log(`✅ Document uploaded: ${documentId}`);

  // 等待文档处理完成
  const processed = await waitForDocumentProcessing(documentId);

  if (!processed) {
    console.log('⚠️  Document processing did not complete, but continuing with tests...');
  }
}

async function step4_createInstance() {
  console.log('\n📝 Step 4: Use Existing Digital Employee Instance');

  // 使用数据库中已存在的员工实例
  instanceId = 'cmsgtjz1v00037qv7aeemwsil'; // 运营总监

  console.log(`✅ Using instance: ${instanceId}`);
}

async function step5_grantKnowledge() {
  console.log('\n📝 Step 5: Grant Knowledge Base to Instance');

  try {
    await request('POST', `/knowledge/${knowledgeBaseId}/grants`, {
      instanceId,
    });

    console.log('✅ Knowledge base granted to instance');
  } catch (error) {
    console.log('⚠️  Grant failed (may need to check implementation)');
    console.log(`   Error: ${error.message}`);
  }
}

async function step6_searchByInstance() {
  console.log('\n📝 Step 6: Search by Instance ID');

  try {
    const data = await request('POST', '/knowledge/search', {
      query: '什么是 RAG 检索',
      instanceId,
      topK: 5,
      scoreThreshold: 0.5,
    });

    console.log(`✅ Search completed: ${data.count} results`);
    console.log('\nResults:');
    data.results.forEach((result, index) => {
      console.log(`\n${index + 1}. Score: ${result.score.toFixed(3)}`);
      console.log(`   Source: ${result.source}`);
      console.log(`   Content: ${result.content.substring(0, 100)}...`);
    });
  } catch (error) {
    console.log('❌ Search by instance failed');
    console.log(`   Error: ${error.message}`);
  }
}

async function step7_searchByKnowledgeBase() {
  console.log('\n📝 Step 7: Search by Knowledge Base IDs');

  try {
    const data = await request('POST', '/knowledge/search/by-knowledge-base', {
      query: '系统架构',
      knowledgeBaseIds: [knowledgeBaseId],
      topK: 3,
      scoreThreshold: 0.5,
    });

    console.log(`✅ Search completed: ${data.count} results`);
    console.log('\nResults:');
    data.results.forEach((result, index) => {
      console.log(`\n${index + 1}. Score: ${result.score.toFixed(3)}`);
      console.log(`   Source: ${result.source}`);
      console.log(`   Content: ${result.content.substring(0, 100)}...`);
    });
  } catch (error) {
    console.log('❌ Search by knowledge base failed');
    console.log(`   Error: ${error.message}`);
  }
}

async function step8_cleanup() {
  console.log('\n📝 Step 8: Cleanup');

  try {
    // 删除知识库（级联删除文档和 chunks）
    await request('DELETE', `/knowledge/${knowledgeBaseId}`);
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.log('⚠️  Cleanup failed');
    console.log(`   Error: ${error.message}`);
  }
}

// ==================== 主流程 ====================

async function main() {
  console.log('='.repeat(60));
  console.log('Phase 2 Week 4 Test: Knowledge Search (RAG)');
  console.log('='.repeat(60));

  try {
    await step1_login();
    await step2_createKnowledgeBase();
    await step3_uploadDocument();
    await step4_createInstance();
    await step5_grantKnowledge();
    await step6_searchByInstance();
    await step7_searchByKnowledgeBase();
    await step8_cleanup();

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();

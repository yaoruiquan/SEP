#!/usr/bin/env node

/**
 * Phase 1 功能验证测试
 * 测试知识库、文档、文本片段的 CRUD 操作
 */

const BASE_URL = 'http://localhost:3001';

// 从环境变量或命令行参数获取测试账号
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Test123456';

let accessToken = '';
let testKnowledgeBaseId = '';
let testDocumentId = '';
let testChunkId = '';

async function request(method, path, body = null, isFormData = false) {
  const headers = {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
  };

  const options = {
    method,
    headers,
    ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, options);

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function login() {
  console.log('🔐 登录测试账号...');
  const data = await request('POST', '/auth/login', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  accessToken = data.token; // 注意：返回的字段是 token，不是 access_token
  console.log('✅ 登录成功');
}

async function testKnowledgeBaseCRUD() {
  console.log('\n📚 测试知识库 CRUD...');

  // 创建知识库
  console.log('  - 创建知识库...');
  const created = await request('POST', '/knowledge', {
    name: `测试知识库 ${Date.now()}`,
    description: 'Phase 1 自动化测试创建的知识库',
  });
  testKnowledgeBaseId = created.id;
  console.log(`  ✅ 创建成功，ID: ${testKnowledgeBaseId}`);

  // 获取知识库列表
  console.log('  - 获取知识库列表...');
  const list = await request('GET', '/knowledge');
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('知识库列表为空');
  }
  console.log(`  ✅ 获取成功，共 ${list.length} 个知识库`);

  // 获取知识库详情
  console.log('  - 获取知识库详情...');
  const detail = await request('GET', `/knowledge/${testKnowledgeBaseId}`);
  if (detail.id !== testKnowledgeBaseId) {
    throw new Error('知识库详情不匹配');
  }
  console.log(`  ✅ 详情获取成功: ${detail.name}`);

  // 更新知识库
  console.log('  - 更新知识库...');
  await request('PATCH', `/knowledge/${testKnowledgeBaseId}`, {
    description: '已更新的描述',
  });
  console.log('  ✅ 更新成功');
}

async function testDocumentUpload() {
  console.log('\n📄 测试文档上传...');

  // 创建一个测试文本文件
  const testContent = 'This is a test document for Phase 1 validation.\n\nIt contains some test content.';
  const blob = new Blob([testContent], { type: 'text/plain' });
  const formData = new FormData();
  formData.append('file', blob, 'test.txt');

  console.log('  - 上传文档...');
  const uploaded = await request(
    'POST',
    `/knowledge/${testKnowledgeBaseId}/documents/upload`,
    formData,
    true
  );
  testDocumentId = uploaded.id;
  console.log(`  ✅ 上传成功，ID: ${testDocumentId}`);

  // 获取文档列表
  console.log('  - 获取文档列表...');
  const docs = await request('GET', `/knowledge/${testKnowledgeBaseId}/documents`);
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error('文档列表为空');
  }
  console.log(`  ✅ 获取成功，共 ${docs.length} 个文档`);

  // 获取文档详情
  console.log('  - 获取文档详情...');
  const docDetail = await request(
    'GET',
    `/knowledge/${testKnowledgeBaseId}/documents/${testDocumentId}`
  );
  if (docDetail.id !== testDocumentId) {
    throw new Error('文档详情不匹配');
  }
  console.log(`  ✅ 详情获取成功: ${docDetail.originalName}`);
}

async function testTextChunkCRUD() {
  console.log('\n📝 测试文本片段 CRUD...');

  // 创建文本片段
  console.log('  - 创建文本片段...');
  const created = await request('POST', `/knowledge/${testKnowledgeBaseId}/chunks`, {
    title: '测试文本片段',
    content: '这是一段测试内容，用于验证文本片段管理功能。',
    tags: ['测试', 'Phase1'],
  });
  testChunkId = created.id;
  console.log(`  ✅ 创建成功，ID: ${testChunkId}`);

  // 获取文本片段列表
  console.log('  - 获取文本片段列表...');
  const chunks = await request('GET', `/knowledge/${testKnowledgeBaseId}/chunks`);
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('文本片段列表为空');
  }
  console.log(`  ✅ 获取成功，共 ${chunks.length} 个文本片段`);

  // 搜索文本片段
  console.log('  - 搜索文本片段...');
  const searchResults = await request(
    'GET',
    `/knowledge/${testKnowledgeBaseId}/chunks?search=测试`
  );
  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    throw new Error('搜索结果为空');
  }
  console.log(`  ✅ 搜索成功，找到 ${searchResults.length} 个匹配项`);

  // 更新文本片段
  console.log('  - 更新文本片段...');
  await request('PATCH', `/knowledge/${testKnowledgeBaseId}/chunks/${testChunkId}`, {
    content: '这是更新后的内容。',
    tags: ['测试', 'Phase1', '已更新'],
  });
  console.log('  ✅ 更新成功');

  // 获取更新后的详情
  console.log('  - 验证更新...');
  const updated = await request(
    'GET',
    `/knowledge/${testKnowledgeBaseId}/chunks/${testChunkId}`
  );
  if (updated.tags.length !== 3) {
    throw new Error('标签更新失败');
  }
  console.log('  ✅ 更新验证成功');
}

async function cleanup() {
  console.log('\n🧹 清理测试数据...');

  // 删除文本片段
  if (testChunkId) {
    console.log('  - 删除文本片段...');
    await request('DELETE', `/knowledge/${testKnowledgeBaseId}/chunks/${testChunkId}`);
    console.log('  ✅ 文本片段已删除');
  }

  // 删除文档
  if (testDocumentId) {
    console.log('  - 删除文档...');
    await request('DELETE', `/knowledge/${testKnowledgeBaseId}/documents/${testDocumentId}`);
    console.log('  ✅ 文档已删除');
  }

  // 删除知识库
  if (testKnowledgeBaseId) {
    console.log('  - 删除知识库...');
    await request('DELETE', `/knowledge/${testKnowledgeBaseId}`);
    console.log('  ✅ 知识库已删除');
  }
}

async function main() {
  console.log('🚀 Phase 1 功能验证测试开始\n');
  console.log(`测试账号: ${TEST_EMAIL}`);
  console.log(`后端地址: ${BASE_URL}\n`);

  try {
    await login();
    await testKnowledgeBaseCRUD();
    await testDocumentUpload();
    await testTextChunkCRUD();
    await cleanup();

    console.log('\n✅ Phase 1 所有测试通过！\n');
    console.log('验证项目：');
    console.log('  ✅ 用户认证');
    console.log('  ✅ 知识库 CRUD');
    console.log('  ✅ 文档上传');
    console.log('  ✅ 文档列表查询');
    console.log('  ✅ 文本片段 CRUD');
    console.log('  ✅ 文本片段搜索');
    console.log('  ✅ 标签管理');
    console.log('  ✅ 数据清理');
    console.log('\n🎉 Phase 1 功能验证完成，可以进入 Phase 2！');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    console.error(error.stack);

    console.log('\n尝试清理测试数据...');
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error('清理失败:', cleanupError.message);
    }

    process.exit(1);
  }
}

// 全局错误处理
process.on('unhandledRejection', (error) => {
  console.error('\n❌ 未处理的异常:', error);
  process.exit(1);
});

main();

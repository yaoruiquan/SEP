#!/usr/bin/env node
/**
 * 测试数字员工头像生成
 * 用法: node scripts/test-avatars.js
 */

const https = require('https');

const SAMPLE_EMPLOYEES = [
  { name: '前端开发工程师', seed: 'qianduan-engineer' },
  { name: '后端开发工程师', seed: 'houduan-engineer' },
  { name: '产品经理', seed: 'product-manager' },
  { name: '销售代表', seed: 'sales-representative' },
  { name: '客服专员', seed: 'customer-service' },
];

console.log('测试 DiceBear 9.x personas 头像生成:\n');

SAMPLE_EMPLOYEES.forEach((emp) => {
  const url = `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(emp.seed)}`;
  console.log(`【${emp.name}】`);
  console.log(`   ${url}\n`);
  
  https.get(url, (res) => {
    if (res.statusCode === 200) {
      console.log(`   ✅ 状态码: ${res.statusCode}, 类型: ${res.headers['content-type']}`);
    } else {
      console.log(`   ❌ 状态码: ${res.statusCode}`);
    }
  }).on('error', (err) => {
    console.log(`   ❌ 请求失败: ${err.message}`);
  });
});

console.log('\n💡 提示: 在浏览器中打开上述 URL 查看实际头像效果');
console.log('💡 或访问 Prisma Studio (http://localhost:5555) 查看 digital_employees 表\n');

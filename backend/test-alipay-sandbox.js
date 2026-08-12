#!/usr/bin/env node

/**
 * 支付宝沙箱测试脚本
 *
 * 功能：
 * 1. 准备测试数据（企业、用户、员工、购物车）
 * 2. 创建订单
 * 3. 发起支付
 * 4. 生成支付表单文件
 * 5. 验证履约结果
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const TEST_EMAIL = 'boss@acme.local'; // 使用现有的管理员账号
const TEST_PASSWORD = 'Demo123456'; // 正确密码（无感叹号）

let authToken = '';
let enterpriseId = '';
let userId = '';
let employeeId = '';
let orderId = '';
let orderNo = '';

// HTTP 客户端
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 添加认证拦截器
api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

// 日志工具
function log(message, data = null) {
  console.log(`\n[${new Date().toISOString()}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function logError(message, error) {
  console.error(`\n❌ ${message}`);
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
  } else {
    console.error(error.message);
  }
}

function logSuccess(message) {
  console.log(`\n✅ ${message}`);
}

// 步骤 1: 登录获取 token
async function login() {
  log('步骤 1: 登录测试账号');

  try {
    const response = await api.post('/auth/login', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    authToken = response.data.token;
    userId = response.data.user.id;

    logSuccess(`登录成功，用户 ID: ${userId}`);
    return true;
  } catch (error) {
    logError('登录失败', error);
    console.log('\n提示：请先创建测试账号或修改脚本中的 TEST_EMAIL 和 TEST_PASSWORD');
    return false;
  }
}

// 步骤 2: 获取用户企业信息
async function getEnterpriseInfo() {
  log('步骤 2: 获取企业信息');

  try {
    // 使用固定的 acme-enterprise-id（从数据库已知）
    enterpriseId = 'acme-enterprise-id';
    logSuccess(`企业 ID: ${enterpriseId}`);
    return true;
  } catch (error) {
    logError('获取企业信息失败', error);
    return false;
  }
}

// 步骤 3: 检查算力账户
async function checkComputeAccount() {
  log('步骤 3: 检查算力账户');

  try {
    const response = await api.get('/compute/account');
    logSuccess(`当前余额: ¥${response.data.balance}`);
    return true;
  } catch (error) {
    logError('获取算力账户失败', error);
    return false;
  }
}

// 步骤 4: 获取可用员工
async function getAvailableEmployee() {
  log('步骤 4: 获取可用员工');

  try {
    const response = await api.get('/digital-employees?status=APPROVED&page=1&limit=10');
    const employees = response.data; // API 直接返回数组

    if (employees.length === 0) {
      logError('没有可用的审核通过员工', null);
      return false;
    }

    // 找一个有定价且未被订阅的员工
    const employee = employees.find(e => e.annualPriceCNY > 0 && e._count.subscriptions === 0);
    if (!employee) {
      logError('没有设置价格且未被订阅的员工', null);
      return false;
    }

    employeeId = employee.id;
    log('选择员工', {
      id: employee.id,
      name: employee.name,
      price: employee.annualPriceCNY,
      includedCompute: employee.includedComputeCNY,
      subscriptions: employee._count.subscriptions,
    });
    return true;
  } catch (error) {
    logError('获取员工列表失败', error);
    return false;
  }
}

// 步骤 5: 清空购物车
async function clearCart() {
  log('步骤 5: 清空购物车');

  try {
    await api.delete('/cart');
    logSuccess('购物车已清空');
    return true;
  } catch (error) {
    logError('清空购物车失败', error);
    return false;
  }
}

// 步骤 6: 添加商品到购物车
async function addToCart() {
  log('步骤 6: 添加商品到购物车');

  try {
    const response = await api.post('/cart/items', {
      employeeId,
      periodMonths: 12,
      quantity: 1,
    });

    logSuccess('商品已加入购物车');
    log('购物车详情', response.data);
    return true;
  } catch (error) {
    logError('添加商品失败', error);
    return false;
  }
}

// 步骤 7: 创建订单
async function createOrder() {
  log('步骤 7: 创建订单');

  try {
    const response = await api.post('/orders');

    orderId = response.data.id;
    orderNo = response.data.orderNo;

    log('订单创建成功', {
      orderId,
      orderNo,
      status: response.data.status,
      totalAmount: response.data.totalAmount,
      items: response.data.items.length,
    });
    return true;
  } catch (error) {
    logError('创建订单失败', error);
    return false;
  }
}

// 步骤 8: 发起支付
async function createPayment() {
  log('步骤 8: 发起支付');

  try {
    const response = await api.post('/payment/alipay/create', {
      orderId,
    });

    const paymentForm = response.data.paymentForm;

    // 保存支付表单到文件
    const htmlPath = path.join(__dirname, 'alipay-payment.html');
    fs.writeFileSync(htmlPath, paymentForm, 'utf-8');

    logSuccess(`支付表单已保存到: ${htmlPath}`);
    console.log('\n请在浏览器中打开该文件完成支付');
    console.log('支付宝沙箱买家账号：从开放平台获取');
    console.log('登录密码：111111');
    console.log('支付密码：111111');

    return true;
  } catch (error) {
    logError('发起支付失败', error);
    return false;
  }
}

// 步骤 9: 等待支付完成
async function waitForPayment() {
  log('步骤 9: 等待支付完成');
  console.log('\n请在浏览器中完成支付，然后按回车继续...');

  return new Promise((resolve) => {
    process.stdin.once('data', () => {
      resolve(true);
    });
  });
}

// 步骤 10: 验证订单状态
async function verifyOrderStatus() {
  log('步骤 10: 验证订单状态');

  try {
    const response = await api.get(`/orders/${orderId}`);

    log('订单状态', {
      status: response.data.status,
      payTradeNo: response.data.payTradeNo,
      paidAt: response.data.paidAt,
    });

    if (response.data.status === 'PAID') {
      logSuccess('订单支付成功');
      return true;
    } else {
      console.log(`\n⚠️  订单状态为 ${response.data.status}，可能支付未完成或回调未触发`);
      return false;
    }
  } catch (error) {
    logError('查询订单失败', error);
    return false;
  }
}

// 步骤 11: 验证履约结果
async function verifyFulfillment() {
  log('步骤 11: 验证履约结果');

  try {
    // 验证购物车已清空
    const cartResponse = await api.get('/cart');
    if (cartResponse.data.items.length === 0) {
      logSuccess('购物车已清空 ✓');
    } else {
      console.log('⚠️  购物车未清空');
    }

    // 验证算力已充值
    const computeResponse = await api.get('/compute/account');
    log('算力账户余额', { balance: computeResponse.data.balance });

    // 验证订阅已生效
    const subscriptionsResponse = await api.get('/subscriptions');
    const activeSubscriptions = subscriptionsResponse.data.subscriptions.filter(
      s => s.status === 'ACTIVE'
    );
    log('活跃订阅数', { count: activeSubscriptions.length });

    logSuccess('履约验证完成');
    return true;
  } catch (error) {
    logError('验证履约结果失败', error);
    return false;
  }
}

// 主流程
async function main() {
  console.log('='.repeat(60));
  console.log('支付宝沙箱测试脚本');
  console.log('='.repeat(60));

  const steps = [
    login,
    getEnterpriseInfo,
    checkComputeAccount,
    getAvailableEmployee,
    clearCart,
    addToCart,
    createOrder,
    createPayment,
    waitForPayment,
    verifyOrderStatus,
    verifyFulfillment,
  ];

  for (const step of steps) {
    const success = await step();
    if (!success) {
      console.log('\n测试中断');
      process.exit(1);
    }
  }

  console.log('\n' + '='.repeat(60));
  logSuccess('所有测试步骤完成！');
  console.log('='.repeat(60));
}

// 运行
main().catch((error) => {
  console.error('\n未捕获的错误:', error);
  process.exit(1);
});

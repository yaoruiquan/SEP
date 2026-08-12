# 支付宝沙箱测试检查清单

测试日期：________
测试人员：________
测试环境：沙箱

## 前置准备

### 1. 支付宝开放平台配置

- [ ] 已申请沙箱应用
- [ ] 已生成 RSA2 密钥对
- [ ] 已上传应用公钥到开放平台
- [ ] 已下载支付宝公钥（不是应用公钥）
- [ ] 记录沙箱 APPID：________________

### 2. 数据库配置

- [ ] 已执行 `setup-alipay-sandbox.sql`
- [ ] 已填写正确的 APPID
- [ ] 已填写应用私钥（完整 PEM 格式）
- [ ] 已填写支付宝公钥（从开放平台下载）
- [ ] 已设置沙箱网关地址

验证配置：
```sql
SELECT key, "isSecret", description
FROM system_settings
WHERE key LIKE 'alipay.%';
```
预期：4 条记录（appId, privateKey, publicKey, gateway）

### 3. 测试数据准备

- [ ] 已创建测试企业
- [ ] 测试企业有 ComputeAccount（余额可为 0）
- [ ] 已创建测试用户并加入企业（ADMIN 或 OWNER 角色）
- [ ] 至少有一个 APPROVED 状态的 DigitalEmployee
- [ ] 该员工已设置 `annualPriceCNY` 和 `includedComputeCNY`

验证数据：
```sql
-- 检查测试企业
SELECT e.id, e.name, ca.balance
FROM enterprises e
LEFT JOIN compute_accounts ca ON e.id = ca."enterpriseId"
WHERE e.id = 'your-test-enterprise-id';

-- 检查测试用户
SELECT u.email, em.role
FROM users u
JOIN enterprise_members em ON u.id = em."userId"
WHERE em."enterpriseId" = 'your-test-enterprise-id';

-- 检查可用员工
SELECT id, name, "annualPriceCNY", "includedComputeCNY"
FROM digital_employees
WHERE status = 'APPROVED' AND "annualPriceCNY" > 0;
```

### 4. 环境配置

- [ ] `.env` 文件已配置 `API_BASE_URL`
- [ ] `.env` 文件已配置 `WEB_BASE_URL`
- [ ] 后端服务已启动（`pnpm dev:backend`）
- [ ] 如需本地测试回调，已启动 ngrok：`ngrok http 3001`
- [ ] 已更新 `.env` 中的 `API_BASE_URL` 为 ngrok 地址

---

## 功能测试

### 测试场景 1：完整支付流程（主流程）

#### 1.1 登录
```bash
node test-alipay-sandbox.js
```
或手动测试：
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123456!"}'
```

- [ ] 登录成功，获得 token
- [ ] 记录 token：________________

#### 1.2 添加商品到购物车
```bash
curl -X POST http://localhost:3001/cart/items \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"YOUR_EMPLOYEE_ID","periodMonths":12,"quantity":1}'
```

- [ ] 商品成功加入购物车
- [ ] 返回购物车详情（items, totalAmount, totalIncludedCompute）

#### 1.3 创建订单
```bash
curl -X POST http://localhost:3001/orders \
  -H "Authorization: Bearer YOUR_TOKEN"
```

- [ ] 订单创建成功
- [ ] 记录订单号：________________
- [ ] 记录订单 ID：________________
- [ ] 订单状态为 `PENDING`
- [ ] 总金额计算正确
- [ ] 订单项信息完整（employeeName, unitPrice, quantity, periodMonths）

#### 1.4 发起支付
```bash
curl -X POST http://localhost:3001/payment/alipay/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"YOUR_ORDER_ID"}'
```

- [ ] 支付表单生成成功
- [ ] 返回 `paymentForm` HTML
- [ ] 将 HTML 保存为 `alipay-payment.html`

#### 1.5 支付宝收银台
- [ ] 在浏览器打开 `alipay-payment.html`
- [ ] 自动跳转到支付宝沙箱收银台
- [ ] 收银台显示正确的订单号和金额
- [ ] 使用沙箱买家账号登录
  - 买家账号：________________（从开放平台获取）
  - 登录密码：111111
  - 支付密码：111111
- [ ] 支付成功

#### 1.6 异步通知回调
查看后端日志：
- [ ] 收到支付宝异步通知（`POST /payment/alipay/notify`）
- [ ] 签名验证通过
- [ ] 订单履约开始
- [ ] 日志中包含：`订单 XXXXXX 已创建`
- [ ] 日志中包含：`订阅 XXXXXX 已生效，创建 X 个实例`
- [ ] 日志中包含：`算力账户 XXXXXX 已充值 XXXX 元`
- [ ] 日志中包含：`购物车已清空，删除 X 项`
- [ ] 日志中包含：`订单 XXXXXX 履约完成`

#### 1.7 验证订单状态
```bash
curl -X GET http://localhost:3001/orders/YOUR_ORDER_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

- [ ] 订单状态为 `PAID`
- [ ] `payTradeNo` 已填充
- [ ] `paidAt` 已记录

#### 1.8 验证履约结果

**购物车已清空：**
```bash
curl -X GET http://localhost:3001/cart \
  -H "Authorization: Bearer YOUR_TOKEN"
```
- [ ] `items` 为空数组
- [ ] `itemCount` 为 0

**订阅已生效：**
```sql
SELECT * FROM subscriptions
WHERE "enterpriseId" = 'your-enterprise-id'
ORDER BY "createdAt" DESC LIMIT 1;
```
- [ ] `status` = 'ACTIVE'
- [ ] `endDate` = `startDate` + 12 个月
- [ ] `employeeId` 正确

**员工实例已创建：**
```sql
SELECT * FROM employee_instances
WHERE "enterpriseId" = 'your-enterprise-id'
ORDER BY "createdAt" DESC;
```
- [ ] 实例数量 = OrderItem.quantity
- [ ] `templateId` = 订单中的 employeeId
- [ ] `status` = 'PENDING_ACTIVATION'

**算力已充值：**
```sql
SELECT * FROM compute_accounts
WHERE "enterpriseId" = 'your-enterprise-id';
```
- [ ] `balance` 增加了 OrderItem.includedComputeCNY

```sql
SELECT * FROM compute_transactions
WHERE "accountId" = 'your-account-id'
ORDER BY "createdAt" DESC LIMIT 1;
```
- [ ] `type` = 'RECHARGE'
- [ ] `amount` = OrderItem.includedComputeCNY
- [ ] `description` 包含订单号

**支付通知已记录：**
```sql
SELECT * FROM payment_notifies
WHERE "outTradeNo" = 'your-order-no';
```
- [ ] `channel` = 'ALIPAY'
- [ ] `verified` = true
- [ ] `processed` = true
- [ ] `tradeNo` 已记录

---

### 测试场景 2：幂等性验证

#### 2.1 模拟重复回调
手动构造支付宝回调请求（使用第一次回调的相同参数）：
```bash
curl -X POST http://localhost:3001/payment/alipay/notify \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "out_trade_no=YOUR_ORDER_NO&trade_no=YOUR_TRADE_NO&trade_status=TRADE_SUCCESS&..."
```

- [ ] 返回 `success`
- [ ] 后端日志显示：`支付宝通知 XXXXX 已处理过，跳过`
- [ ] 订单状态仍为 `PAID`
- [ ] 算力余额未重复增加
- [ ] 员工实例数量未增加
- [ ] `payment_notifies` 表中只有 1 条记录（唯一约束生效）

---

### 测试场景 3：异常场景

#### 3.1 空购物车创建订单
```bash
# 先清空购物车
curl -X DELETE http://localhost:3001/cart \
  -H "Authorization: Bearer YOUR_TOKEN"

# 尝试创建订单
curl -X POST http://localhost:3001/orders \
  -H "Authorization: Bearer YOUR_TOKEN"
```

- [ ] 返回 400 Bad Request
- [ ] 错误信息：`购物车为空，无法创建订单`

#### 3.2 未审核员工无法加入购物车
将某个员工状态改为 `DRAFT`：
```sql
UPDATE digital_employees SET status = 'DRAFT' WHERE id = 'some-employee-id';
```

```bash
curl -X POST http://localhost:3001/cart/items \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"some-employee-id","periodMonths":12,"quantity":1}'
```

- [ ] 返回 400 Bad Request
- [ ] 错误信息包含 `未审核` 或 `DRAFT`

恢复员工状态：
```sql
UPDATE digital_employees SET status = 'APPROVED' WHERE id = 'some-employee-id';
```

#### 3.3 跨租户访问订单
使用另一个企业的用户 token 访问测试企业的订单：

```bash
curl -X GET http://localhost:3001/orders/YOUR_ORDER_ID \
  -H "Authorization: Bearer OTHER_USER_TOKEN"
```

- [ ] 返回 404 Not Found
- [ ] 错误信息：`订单不存在`

#### 3.4 非 PENDING 订单无法支付
```bash
curl -X POST http://localhost:3001/payment/alipay/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"PAID_ORDER_ID"}'
```

- [ ] 返回 400 Bad Request
- [ ] 错误信息：`订单状态为 PAID，无法支付`

#### 3.5 签名验证失败
构造错误签名的回调：
```bash
curl -X POST http://localhost:3001/payment/alipay/notify \
  -d "sign=invalid_signature&..."
```

- [ ] 返回 `fail`
- [ ] 后端日志：`支付宝通知签名验证失败`
- [ ] `payment_notifies` 表无新记录

---

## 性能测试

### 响应时间测试

使用 `time` 或 `curl -w` 测量响应时间：

```bash
curl -w "\nTime: %{time_total}s\n" -X POST http://localhost:3001/orders \
  -H "Authorization: Bearer YOUR_TOKEN"
```

- [ ] 订单创建 < 500ms：实际 _______ ms
- [ ] 支付表单生成 < 200ms：实际 _______ ms
- [ ] 回调履约 < 2s：实际 _______ ms

---

## 问题记录

| 问题描述 | 严重程度 | 重现步骤 | 解决方案 | 状态 |
|---------|---------|---------|---------|------|
|         |         |         |         |      |

---

## 测试结论

**功能测试结果：**
- 完整支付流程：[ ] PASS / [ ] FAIL
- 幂等性验证：[ ] PASS / [ ] FAIL
- 异常场景：[ ] PASS / [ ] FAIL

**性能测试结果：**
- 响应时间：[ ] 符合要求 / [ ] 需要优化

**整体评价：**
[ ] ✅ 通过，可进入下一阶段
[ ] ⚠️ 有小问题，需修复后重测
[ ] ❌ 严重问题，需立即修复

**备注：**
_______________________________________________________________________
_______________________________________________________________________
_______________________________________________________________________

**测试人员签名：** ________________  **日期：** ________________

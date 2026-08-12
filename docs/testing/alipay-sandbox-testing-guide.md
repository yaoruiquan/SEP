# 支付宝沙箱测试指南

## 1. 沙箱环境配置

### 1.1 申请沙箱应用

1. 访问支付宝开放平台：https://open.alipay.com/
2. 登录后进入「开发者中心」→「研发服务」→「沙箱环境」
3. 获取沙箱应用信息：
   - APPID（应用 ID）
   - 应用私钥（RSA2 密钥）
   - 支付宝公钥（RSA2 密钥）
   - 沙箱网关：`https://openapi-sandbox.dl.alipaydev.com/gateway.do`

### 1.2 生成应用密钥对

使用支付宝开放平台提供的「密钥生成工具」：

```bash
# 或使用 OpenSSL 生成
openssl genrsa -out app_private_key.pem 2048
openssl rsa -in app_private_key.pem -pubout -out app_public_key.pem
```

**重要**：
- 上传「应用公钥」到支付宝开放平台
- 下载「支付宝公钥」（不是「应用公钥」）
- 使用「应用私钥」配置到 SystemSetting

### 1.3 配置 SystemSetting

在数据库中插入支付宝沙箱配置：

```sql
-- 1. 支付宝应用 ID（沙箱）
INSERT INTO system_settings (id, key, value, "isSecret", description, "createdAt", "updatedAt")
VALUES (
  'alipay-appid',
  'alipay.appId',
  '你的沙箱APPID',  -- 例如：9021000139658270
  false,
  '支付宝应用 ID（沙箱）',
  NOW(),
  NOW()
);

-- 2. 应用私钥（RSA2）
INSERT INTO system_settings (id, key, value, "isSecret", description, "createdAt", "updatedAt")
VALUES (
  'alipay-private-key',
  'alipay.privateKey',
  '-----BEGIN RSA PRIVATE KEY-----
你的应用私钥内容（多行）
-----END RSA PRIVATE KEY-----',
  true,
  '支付宝应用私钥（RSA2）',
  NOW(),
  NOW()
);

-- 3. 支付宝公钥（RSA2）
INSERT INTO system_settings (id, key, value, "isSecret", description, "createdAt", "updatedAt")
VALUES (
  'alipay-public-key',
  'alipay.publicKey',
  '-----BEGIN PUBLIC KEY-----
支付宝公钥内容（多行，从开放平台下载）
-----END PUBLIC KEY-----',
  true,
  '支付宝公钥（RSA2）',
  NOW(),
  NOW()
);

-- 4. 沙箱网关地址
INSERT INTO system_settings (id, key, value, "isSecret", description, "createdAt", "updatedAt")
VALUES (
  'alipay-gateway',
  'alipay.gateway',
  'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
  false,
  '支付宝网关地址（沙箱）',
  NOW(),
  NOW()
);
```

### 1.4 配置环境变量

在 `.env` 文件中添加：

```env
# API 基础地址（供支付宝回调使用）
API_BASE_URL=http://your-domain.com  # 或使用 ngrok 等内网穿透工具

# 前端地址（支付成功后跳转）
WEB_BASE_URL=http://localhost:3000
```

## 2. 测试数据准备

### 2.1 创建测试企业和用户

确保数据库中存在：
- 测试企业（Enterprise）及其 ComputeAccount
- 测试用户（User）并关联到企业（EnterpriseMember）
- 至少一个 APPROVED 状态的 DigitalEmployee（设置 annualPriceCNY 和 includedComputeCNY）

### 2.2 添加商品到购物车

使用测试脚本或 Swagger UI 调用：

```bash
POST /cart/items
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "employeeId": "员工ID",
  "periodMonths": 12,
  "quantity": 1
}
```

## 3. 测试流程

### 3.1 创建订单

```bash
POST /orders
Authorization: Bearer <admin_token>
```

返回示例：
```json
{
  "id": "order-id",
  "orderNo": "20260811120000123456",
  "status": "PENDING",
  "totalAmount": "5000.00",
  "items": [...]
}
```

### 3.2 发起支付

```bash
POST /payment/alipay/create
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "orderId": "order-id"
}
```

返回示例：
```json
{
  "orderId": "order-id",
  "orderNo": "20260811120000123456",
  "paymentForm": "<form>...</form>"  // HTML 表单
}
```

### 3.3 打开支付页面

1. 将返回的 `paymentForm` HTML 保存为 `pay.html`
2. 在浏览器中打开该文件
3. 自动跳转到支付宝沙箱收银台

### 3.4 使用沙箱账号支付

支付宝沙箱提供测试买家账号：

- 买家账号：从沙箱应用页面获取（格式如 `buyer@sandbox.com`）
- 登录密码：`111111`
- 支付密码：`111111`

### 3.5 验证回调处理

支付成功后，支付宝会调用：

```
POST http://your-domain.com/payment/alipay/notify
```

**本地测试注意**：
- 支付宝无法访问 `localhost`
- 使用 ngrok 等工具暴露本地端口：
  ```bash
  ngrok http 3001
  # 将返回的 https 地址配置到 API_BASE_URL
  ```

### 3.6 检查履约结果

支付成功后，验证以下数据变更：

```sql
-- 1. 订单状态已更新
SELECT * FROM orders WHERE "orderNo" = '20260811120000123456';
-- 预期：status = 'PAID', "payTradeNo" IS NOT NULL

-- 2. 订阅已生效
SELECT * FROM subscriptions WHERE "enterpriseId" = '测试企业ID';
-- 预期：status = 'ACTIVE', "endDate" = NOW() + 12 months

-- 3. 员工实例已创建
SELECT * FROM employee_instances WHERE "enterpriseId" = '测试企业ID';
-- 预期：记录数 = OrderItem.quantity

-- 4. 算力已充值
SELECT * FROM compute_accounts WHERE "enterpriseId" = '测试企业ID';
-- 预期：balance 增加了 OrderItem.includedComputeCNY

SELECT * FROM compute_transactions 
WHERE "accountId" = '算力账户ID' 
ORDER BY "createdAt" DESC LIMIT 1;
-- 预期：type = 'RECHARGE', amount = OrderItem.includedComputeCNY

-- 5. 购物车已清空
SELECT * FROM cart_items WHERE "enterpriseId" = '测试企业ID';
-- 预期：0 条记录

-- 6. 支付通知已记录
SELECT * FROM payment_notifies WHERE "outTradeNo" = '20260811120000123456';
-- 预期：verified = true, processed = true
```

## 4. 验证清单

### 4.1 功能验证

- [ ] 订单创建成功（购物车内容正确转换为订单项）
- [ ] 订单金额计算正确（unitPrice × quantity × periodMonths / 12）
- [ ] 支付表单生成成功（包含正确的订单号和金额）
- [ ] 支付宝沙箱支付流程完整（扫码 → 登录 → 支付）
- [ ] 支付成功后异步通知到达
- [ ] 签名验证通过
- [ ] 幂等性验证（重复通知不重复履约）
- [ ] 订单状态正确更新为 PAID
- [ ] 订阅正确生效（ACTIVE 状态，endDate = 12 个月后）
- [ ] 员工实例创建数量正确
- [ ] 算力充值金额正确
- [ ] 购物车已清空

### 4.2 异常场景验证

- [ ] 空购物车无法创建订单
- [ ] 未审核员工无法创建订单
- [ ] 跨租户无法访问其他企业订单
- [ ] 非 PENDING 订单无法支付
- [ ] 签名错误的回调被拒绝
- [ ] 重复回调不重复履约（PaymentNotify 唯一约束生效）
- [ ] 已支付订单无法再次履约

### 4.3 性能验证

- [ ] 订单创建响应时间 < 500ms
- [ ] 支付表单生成响应时间 < 200ms
- [ ] 回调处理事务完成时间 < 2s

## 5. 常见问题

### 5.1 本地回调无法触发

**原因**：支付宝无法访问 `localhost`

**解决**：
1. 使用 ngrok 暴露本地端口：
   ```bash
   ngrok http 3001
   ```
2. 将 ngrok 返回的 https 地址配置到 `API_BASE_URL`
3. 重启后端服务

### 5.2 签名验证失败

**原因**：
- 应用私钥和公钥不匹配
- 使用了错误的支付宝公钥（应该是「支付宝公钥」，不是「应用公钥」）
- 密钥格式错误（缺少 BEGIN/END 标记）

**解决**：
1. 重新生成密钥对
2. 上传应用公钥到支付宝开放平台
3. 下载「支付宝公钥」（不是应用公钥）
4. 确保密钥包含 `-----BEGIN XXX-----` 和 `-----END XXX-----`

### 5.3 支付后回调未履约

**排查步骤**：
1. 检查 `payment_notifies` 表是否有记录（验证回调是否到达）
2. 检查 `verified` 字段（验证签名是否通过）
3. 检查 `processed` 字段（验证是否已处理）
4. 查看后端日志中的错误信息

### 5.4 算力账户不存在

**原因**：企业创建时未自动创建 ComputeAccount

**解决**：
```sql
INSERT INTO compute_accounts (id, "enterpriseId", balance, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), '测试企业ID', 0, NOW(), NOW());
```

## 6. 测试报告模板

```markdown
# 支付宝沙箱测试报告

测试日期：2026-08-11
测试人员：XXX
测试环境：沙箱

## 测试结果

| 功能点 | 状态 | 备注 |
|--------|------|------|
| 订单创建 | ✅ PASS | |
| 支付表单生成 | ✅ PASS | |
| 支付宝收银台 | ✅ PASS | |
| 异步回调 | ✅ PASS | |
| 签名验证 | ✅ PASS | |
| 订单履约 | ✅ PASS | |
| 幂等性 | ✅ PASS | |

## 异常场景

| 场景 | 状态 | 备注 |
|------|------|------|
| 空购物车拒绝 | ✅ PASS | |
| 未审核员工拒绝 | ✅ PASS | |
| 跨租户隔离 | ✅ PASS | |
| 重复回调防护 | ✅ PASS | |

## 问题记录

（如有问题记录在此）

## 结论

沙箱测试 [✅ 通过 / ❌ 未通过]
```

## 7. 生产环境上线前检查

- [ ] 将沙箱配置替换为生产环境配置
- [ ] 更新 `alipay.gateway` 为 `https://openapi.alipay.com/gateway.do`
- [ ] 更新 `API_BASE_URL` 为生产域名
- [ ] 配置 HTTPS（支付宝要求回调地址必须是 HTTPS）
- [ ] 配置防火墙白名单（支付宝回调 IP）
- [ ] 配置日志监控和告警
- [ ] 备份数据库
- [ ] 灰度测试（小额真实订单）

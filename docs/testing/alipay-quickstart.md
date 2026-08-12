# 支付宝沙箱测试快速启动指南

## 10 分钟快速开始

### 第一步：获取沙箱应用信息（2 分钟）

1. 访问 https://open.alipay.com/
2. 登录 → 开发者中心 → 研发服务 → 沙箱环境
3. 记录以下信息：
   - **APPID**（应用 ID）
   - **沙箱买家账号**（用于支付）

### 第二步：生成密钥对（3 分钟）

**方法 A：使用支付宝密钥生成工具（推荐）**

1. 下载工具：https://opendocs.alipay.com/common/02kipl
2. 选择 RSA2(SHA256) 密钥长度 2048
3. 点击「生成密钥」
4. 保存「应用私钥」和「应用公钥」

**方法 B：使用 OpenSSL（命令行）**

```bash
# 生成私钥
openssl genrsa -out app_private_key.pem 2048

# 生成公钥
openssl rsa -in app_private_key.pem -pubout -out app_public_key.pem
```

### 第三步：配置开放平台（1 分钟）

1. 在沙箱应用页面，点击「设置应用公钥」
2. 上传步骤二生成的「应用公钥」内容
3. 点击「查看支付宝公钥」，复制保存（后续配置需要）

### 第四步：配置数据库（2 分钟）

编辑 `backend/scripts/setup-alipay-sandbox.sql`，替换以下占位符：

```sql
-- 1. 替换 APPID
'你的沙箱APPID' → '9021000139658270'  -- 你的实际 APPID

-- 2. 替换应用私钥（完整内容，包含 BEGIN/END）
'-----BEGIN RSA PRIVATE KEY-----
你的应用私钥内容（多行）
-----END RSA PRIVATE KEY-----'

-- 3. 替换支付宝公钥（从开放平台复制）
'-----BEGIN PUBLIC KEY-----
支付宝公钥内容（多行）
-----END PUBLIC KEY-----'
```

执行 SQL 脚本：

```bash
psql -U postgres -d your_database -f backend/scripts/setup-alipay-sandbox.sql
```

### 第五步：准备测试数据（1 分钟）

确保数据库中存在：

```sql
-- 1. 测试企业 + 算力账户
SELECT e.id, e.name, ca.balance
FROM enterprises e
LEFT JOIN compute_accounts ca ON e.id = ca."enterpriseId"
LIMIT 1;

-- 如果没有算力账户，创建一个：
INSERT INTO compute_accounts (id, "enterpriseId", balance, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), '你的企业ID', 0, NOW(), NOW());

-- 2. 测试用户（ADMIN 或 OWNER 角色）
SELECT u.email, em.role
FROM users u
JOIN enterprise_members em ON u.id = em."userId"
WHERE em."enterpriseId" = '你的企业ID';

-- 3. 已审核员工（设置价格）
SELECT id, name, "annualPriceCNY", "includedComputeCNY"
FROM digital_employees
WHERE status = 'APPROVED' AND "annualPriceCNY" > 0
LIMIT 1;

-- 如果没有，更新一个员工：
UPDATE digital_employees
SET "annualPriceCNY" = 5000.00,
    "includedComputeCNY" = 1000.00,
    status = 'APPROVED'
WHERE id = '某个员工ID';
```

### 第六步：运行测试（1 分钟）

启动后端服务：

```bash
cd backend
pnpm dev:backend
```

运行测试脚本：

```bash
node test-alipay-sandbox.js
```

脚本会自动：
1. 登录测试账号
2. 清空购物车
3. 添加商品
4. 创建订单
5. 生成支付表单（保存为 `alipay-payment.html`）

在浏览器打开 `alipay-payment.html`，使用沙箱买家账号完成支付。

---

## 本地测试回调（可选，需要内网穿透）

如果需要测试支付宝异步回调（支付宝无法访问 localhost），使用 ngrok：

```bash
# 安装 ngrok
brew install ngrok  # macOS
# 或从 https://ngrok.com/ 下载

# 启动隧道
ngrok http 3001

# 将返回的 https 地址更新到 .env
API_BASE_URL=https://xxxx-xx-xx-xx-xx.ngrok-free.app
```

重启后端服务，重新运行测试脚本。

---

## 常见问题速查

### Q1: 签名验证失败

**症状**：支付后回调日志显示「签名验证失败」

**原因**：
- 使用了错误的支付宝公钥（应该是「支付宝公钥」，不是「应用公钥」）
- 密钥格式错误（缺少 BEGIN/END 标记）

**解决**：
1. 重新从开放平台复制「支付宝公钥」
2. 确保包含完整的 `-----BEGIN PUBLIC KEY-----` 和 `-----END PUBLIC KEY-----`

### Q2: 支付后订单未履约

**症状**：支付成功，但订单状态仍为 PENDING

**排查**：
```sql
-- 1. 检查是否收到回调
SELECT * FROM payment_notifies WHERE "outTradeNo" = '你的订单号';

-- 如果没有记录：回调未到达（检查 ngrok 或 API_BASE_URL）
-- 如果 verified = false：签名验证失败（检查密钥配置）
-- 如果 processed = false：履约失败（查看后端日志）
```

### Q3: 本地无法收到回调

**症状**：支付成功，但后端日志没有收到回调请求

**原因**：支付宝无法访问 `localhost`

**解决**：
1. 使用 ngrok 暴露本地端口
2. 更新 `.env` 中的 `API_BASE_URL` 为 ngrok 地址
3. 重启后端服务

### Q4: 算力账户不存在

**症状**：履约失败，日志显示「企业 XXX 的算力账户不存在」

**解决**：
```sql
INSERT INTO compute_accounts (id, "enterpriseId", balance, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), '你的企业ID', 0, NOW(), NOW());
```

---

## 测试成功标志

✅ 所有步骤顺利完成后，你应该看到：

1. **订单状态**：`PAID`
2. **购物车**：已清空
3. **订阅**：`ACTIVE` 状态，endDate = 12 个月后
4. **员工实例**：已创建（数量 = 订单中的 quantity）
5. **算力余额**：增加了赠送金额
6. **支付通知**：`verified = true`, `processed = true`

---

## 下一步

测试通过后：
- [ ] 填写测试检查清单（`alipay-sandbox-test-checklist.md`）
- [ ] 截图保存测试结果
- [ ] 准备生产环境配置（替换沙箱为正式应用信息）
- [ ] 配置生产环境 HTTPS + 域名
- [ ] 配置防火墙白名单（支付宝回调 IP）

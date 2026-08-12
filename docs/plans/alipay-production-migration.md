# 支付宝生产环境迁移任务

## 任务概述

将支付宝从沙箱测试环境切换到生产环境，接入公司真实支付宝商户账号。

## 当前状态

✅ **已完成**：
- 订单支付流程（员工订阅）
- 充值支付流程（算力账户）
- 支付回调路由（根据订单号前缀区分：`ORD` = 订单，`RCH` = 充值）
- 幂等性处理（`PaymentNotify` 表防重）
- 前端支付跳转（两个入口都已修复）

⚠️ **当前环境**：支付宝沙箱（开发测试）
- 沙箱网关：`https://openapi-sandbox.dl.alipaydev.com/gateway.do`
- 不涉及真实资金
- 需要沙箱测试账号才能完成支付

## 迁移步骤

### 1. 申请企业支付宝商户账号

**前置条件**：
- 企业营业执照
- 对公银行账户
- 法人身份证件

**操作步骤**：
1. 访问 https://open.alipay.com/
2. 注册企业开发者账号
3. 创建应用（选择"网页/移动应用"）
4. 签约产品：
   - **电脑网站支付**（PC 端订单/充值）
   - 或 **手机网站支付**（移动端）
5. 等待支付宝审核（通常 1-3 个工作日）

### 2. 获取生产环境密钥

审核通过后，从支付宝开放平台获取以下信息：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `ALIPAY_APP_ID` | 应用 ID（APPID） | `2021001234567890` |
| `ALIPAY_PRIVATE_KEY` | 应用私钥（RSA2048） | 需生成并上传公钥到支付宝 |
| `ALIPAY_PUBLIC_KEY` | 支付宝公钥 | 从支付宝平台下载 |
| `ALIPAY_GATEWAY` | 生产网关地址 | `https://openapi.alipay.com/gateway.do` |

**生成密钥对**（RSA2048）：
```bash
# 使用支付宝官方工具生成
# 下载地址：https://opendocs.alipay.com/common/02kipl

# 或使用 OpenSSL
openssl genrsa -out app_private_key.pem 2048
openssl rsa -in app_private_key.pem -pubout -out app_public_key.pem
```

上传 `app_public_key.pem` 到支付宝开放平台，然后下载支付宝公钥。

### 3. 配置回调地址（重要！）

在支付宝开放平台应用配置中设置：

| 配置项 | 地址 | 说明 |
|--------|------|------|
| **异步通知地址** | `https://yourdomain.com/payment/alipay/notify` | 必须 HTTPS，公网可访问 |
| **同步返回地址** | `https://yourdomain.com/payment/result` | 用户支付后跳转页面 |

⚠️ **关键要求**：
- 必须是 **HTTPS**（不能是 HTTP）
- 必须是 **公网域名**（`localhost` 无法接收回调）
- 异步通知 URL **不能带参数**（支付宝会拒绝）
- 服务器防火墙需开放 443 端口

### 4. 更新后端配置

**方式 1：通过数据库配置（推荐）**

更新 `SystemSetting` 表：

```sql
-- 1. 更新应用 ID
UPDATE system_settings 
SET value = '2021001234567890'  -- 替换为真实 APPID
WHERE key = 'alipay.appId';

-- 2. 更新应用私钥
UPDATE system_settings 
SET value = '-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...  -- 完整私钥内容
-----END RSA PRIVATE KEY-----'
WHERE key = 'alipay.privateKey';

-- 3. 更新支付宝公钥
UPDATE system_settings 
SET value = '-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
-----END PUBLIC KEY-----'
WHERE key = 'alipay.publicKey';

-- 4. 更新网关地址（生产环境）
UPDATE system_settings 
SET value = 'https://openapi.alipay.com/gateway.do'
WHERE key = 'alipay.gateway';
```

**方式 2：通过环境变量（备选）**

在 `.env` 文件中配置：

```bash
ALIPAY_APP_ID=2021001234567890
ALIPAY_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
ALIPAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----"
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
```

然后修改 `backend/src/modules/payment/payment.service.ts`：

```typescript
// 优先读取环境变量，如果没有则从数据库读取
const appId = process.env.ALIPAY_APP_ID || settings.get('alipay.appId');
const privateKey = process.env.ALIPAY_PRIVATE_KEY || settings.get('alipay.privateKey');
const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY || settings.get('alipay.publicKey');
const gateway = process.env.ALIPAY_GATEWAY || settings.get('alipay.gateway');
```

### 5. 部署到生产服务器

**前置条件**：
- 服务器有公网 IP 和域名
- 已配置 HTTPS 证书（Let's Encrypt 或商业证书）
- 域名解析指向服务器

**部署步骤**：

```bash
# 1. 构建生产版本
pnpm build

# 2. 上传到服务器（示例）
scp -r backend/dist user@server:/var/www/sep/backend/
scp -r web/.next user@server:/var/www/sep/web/

# 3. 在服务器上启动服务
pm2 start backend/dist/main.js --name sep-backend
pm2 start web/server.js --name sep-web

# 4. 配置 Nginx 反向代理（HTTPS）
# 参考 docs/deployment/nginx.conf
```

### 6. 测试生产环境支付

**测试流程**：

1. **小金额测试**：
   - 创建 ¥0.01 的订单
   - 完成真实支付
   - 验证回调是否收到
   - 检查订单状态是否更新

2. **验证异步通知**：
   - 查看 `PaymentNotify` 表是否有记录
   - 检查订单状态是否从 `PENDING` → `PAID`
   - 验证用户余额是否增加（充值场景）
   - 验证员工实例是否创建（订单场景）

3. **验证幂等性**：
   - 手动重放同一笔交易的回调
   - 确认不会重复创建记录或重复扣款

4. **异常场景测试**：
   - 支付后不返回（关闭浏览器）→ 异步回调仍能完成订单
   - 重复点击支付按钮 → 不会创建重复订单
   - 支付超时（15 分钟不支付）→ 订单保持 `PENDING` 状态

### 7. 监控和日志

**生产环境必须监控**：

1. **支付成功率**：
   - 创建订单数 vs 支付成功数
   - 目标：≥ 95%

2. **回调到达率**：
   - 支付成功数 vs 异步回调收到数
   - 目标：100%（如果 < 100%，检查服务器防火墙/域名配置）

3. **异常告警**：
   - 回调验签失败
   - 订单金额不匹配
   - 重复支付尝试

**日志保留**：
```typescript
// 在 payment.service.ts 中已有日志
this.logger.log(`支付宝回调: ${trade_no}, 订单 ${out_trade_no}, 金额 ${total_amount}`);
this.logger.error(`支付宝签名验证失败: ${trade_no}`);
```

建议配置日志持久化（如 Winston + 文件存储或 ELK）。

## 安全检查清单

- [ ] 私钥不要提交到 Git（使用环境变量或加密存储）
- [ ] 回调接口验证签名（已实现）
- [ ] 订单金额校验（后端计算 vs 支付宝返回）
- [ ] 幂等性处理（`PaymentNotify.trade_no` 唯一索引）
- [ ] HTTPS 证书有效期监控
- [ ] 支付宝 IP 白名单（可选，支付宝开放平台配置）

## 回滚方案

如果生产环境出现问题，快速回滚到沙箱：

```sql
-- 恢复沙箱配置
UPDATE system_settings 
SET value = '9021000166675041' 
WHERE key = 'alipay.appId';

UPDATE system_settings 
SET value = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
WHERE key = 'alipay.gateway';
```

然后重启后端服务。

## 参考文档

- 支付宝开放平台：https://open.alipay.com/
- 电脑网站支付文档：https://opendocs.alipay.com/open/270
- 签名工具下载：https://opendocs.alipay.com/common/02kipl
- 沙箱环境说明：https://opendocs.alipay.com/common/02kkv7

## 相关代码位置

- **后端支付服务**：`backend/src/modules/payment/payment.service.ts`
- **支付控制器**：`backend/src/modules/payment/payment.controller.ts`
- **订单服务**：`backend/src/modules/payment/order.service.ts`
- **充值服务**：`backend/src/modules/compute/compute.service.ts`
- **前端订单支付**：`web/src/app/(enterprise)/checkout/page.tsx`
- **前端充值支付**：`web/src/app/(enterprise)/usage/page.tsx`
- **测试文档**：`docs/testing/recharge-payment-flow.md`

## 预估工作量

- 申请商户账号：1-3 个工作日（等待支付宝审核）
- 配置和测试：2-4 小时
- 部署和验证：1-2 小时

总计：**约 2 天**（含等待审核时间）

## 注意事项

1. **先在沙箱环境充分测试**，确认所有流程正常后再切换生产
2. **小金额试单**，不要一开始就测试大额订单
3. **备份数据库**，切换前做好数据备份
4. **通知用户**，如果是已上线系统，需提前通知用户支付功能维护时间

---

创建日期：2026-08-12  
最后更新：2026-08-12  
负责人：待指定

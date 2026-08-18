# 支付宝真实对接计划（正式账号切换）

> 日期：2026-08-17
> 对应会议纪要：08-12 会议 P1 §2「将支付宝配置切换到公司正式账号」、风险 §六.2、待确认 §七.3
> 前置成果：沙箱链路已全量跑通（见 `docs/progress/2026-08-11-sprint1-task1.4-alipay-test-report.md`）
> 状态：代码零改动，等待公司凭证与域名（配置类切换）

## 一、背景

当前支付链路已在沙箱环境完整跑通：

```
充值下单 (RechargeOrder, RCH 前缀)
  → PaymentService.createPagePayment
  → AlipayProvider (alipay-sdk ^4.14.0, RSA2)
  → 支付宝收银台
  → 异步回调 POST /payment/alipay/notify
  → 验签 + 幂等 (PaymentNotify 表)
  → TRADE_SUCCESS/FINISHED 按单号前缀路由
      RCH* → ComputeService.fulfillRechargeOrder → WalletService.deposit
      ORD* → OrderService（订阅订单）
```

**关键结论：代码中没有硬编码沙箱逻辑。** 唯一的沙箱开关是环境变量
`ALIPAY_SANDBOX_MODE="true"`（根 `.env:47`），作用仅为跳过回调验签
（`alipay.provider.ts:84-88`）。切换到正式环境是**纯配置操作**，
不改业务代码。

## 二、现有配置结构

凭证存放在 **SystemSetting 表**（非环境变量），category='payment'、isSecret：

| key | 说明 |
|-----|------|
| `alipay.appId` | 应用 App ID |
| `alipay.privateKey` | 应用私钥（RSA2） |
| `alipay.publicKey` | 支付宝公钥 |
| `alipay.gateway` | 网关地址 |

`backend/scripts/setup-alipay-sandbox.sql` 第 158-185 行已有现成的
**注释好的生产切换 SQL 模板**（4 条 UPDATE system_settings）。

相关环境变量（根 `.env`）：

| 变量 | 当前值 | 生产要求 |
|------|--------|----------|
| `ALIPAY_SANDBOX_MODE` | `true` | 删除或置 `false` |
| `API_BASE_URL` | `http://localhost:3001` | 公网 HTTPS 域名（回调地址 = `${API_BASE_URL}/payment/alipay/notify`） |
| `WEB_BASE_URL` | `http://localhost:3000` | 公网 HTTPS 域名（支付完成跳回 `${WEB_BASE_URL}/payment/result`） |
| `FRONTEND_URL` | — | 充值结果页 `/payment/recharge/result`（wallet.controller.ts:95） |

## 三、切换步骤

### 步骤 1 — 收集公司凭证（阻塞项，依赖外部）
- [ ] 公司企业支付宝账号开通「电脑网站支付」（FAST_INSTANT_TRADE_PAY）
- [ ] 在开放平台创建应用，获取：App ID、应用私钥、支付宝公钥
- [ ] 确认签约产品与费率；确认结算账户

### 步骤 2 — 域名与回调配置（阻塞项，依赖外部）
- [ ] 确定 API 公网域名（HTTPS），更新 `API_BASE_URL`
- [ ] 确定 Web 公网域名（HTTPS），更新 `WEB_BASE_URL` / `FRONTEND_URL`
- [ ] 支付宝开放平台应用内配置授权回调域名（如需）

### 步骤 3 — 数据库配置切换
- [ ] 执行生产配置 SQL（基于 `setup-alipay-sandbox.sql:158-185` 模板，
      填入真实值）：
      ```sql
      UPDATE system_settings SET value = '<正式 App ID>'       WHERE key = 'alipay.appId';
      UPDATE system_settings SET value = '<应用私钥>'           WHERE key = 'alipay.privateKey';
      UPDATE system_settings SET value = '<支付宝公钥>'         WHERE key = 'alipay.publicKey';
      UPDATE system_settings SET value = 'https://openapi.alipay.com/gateway.do' WHERE key = 'alipay.gateway';
      ```
- [ ] 注意：`alipay.provider.ts:40` 的网关兜底值已是正式网关，配置缺失时不会误连沙箱

### 步骤 4 — 环境变量切换
- [ ] `ALIPAY_SANDBOX_MODE` 置 false 或删除 → **恢复真实验签**（关键安全项）
- [ ] 三个 URL 变量改为公网 HTTPS 地址

### 步骤 5 — 验证（生产环境）
- [ ] 小额（0.01 元）真实支付：下单 → 收银台 → 支付 → 回调验签通过 → 钱包到账
- [ ] 验证回调幂等：重复推送同一 notify 不重复入账
- [ ] 验证支付失败/超时路径：订单状态正确、失败提示正常
- [ ] 验证主动查单 `queryTrade` 兜底（回调丢失场景）

### 步骤 6 — 上线加固（可选增强）
- [ ] 支付状态同步定时任务：扫描 `NOT_PAY` 超时订单主动查单对账
- [ ] notify 接口增加来源 IP / 重放保护观察（当前已有幂等表）
- [ ] 订单记录页补充失败原因展示

## 四、风险与回滚

| 风险 | 说明 | 缓解 |
|------|------|------|
| 凭证泄露 | 私钥入库 | SystemSetting isSecret 标记；SQL 执行后不留明文文件；轮换机制 |
| 回调不可达 | 本地/内网收不到异步通知 | 必须公网 HTTPS；上线前用查单接口兜底验证 |
| 验签关闭遗留 | 忘关 ALIPAY_SANDBOX_MODE 则回调不验签 | 上线 checklist 强制项 + 启动日志打印当前模式 |
| 金额/对账差错 | 真实资金 | 上线首日小额验证 + 对账脚本比对 PaymentNotify 与支付宝账单 |

**回滚方案**：将 4 条 SystemSetting 改回沙箱值 + `ALIPAY_SANDBOX_MODE=true`
即可完整回到沙箱环境，无数据迁移。

## 五、依赖清单（当前全部未就绪）

1. 公司支付宝正式账号及产品签约 —— 待确认事项 §七.3
2. API / Web 公网 HTTPS 域名 —— 待确认事项 §七.3
3. 上线配置时间窗口

**结论：代码侧已完成且经过沙箱验证，切换本身预计半天内完成；
当前完全阻塞在公司凭证与域名上。按用户指示，本计划排在知识库
三个 Phase 之后执行。**

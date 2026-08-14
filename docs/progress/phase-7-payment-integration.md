# Phase 7: 支付集成完成报告

## 实现时间
2026-08-14

## 目标
将充值订单流程连接到真实的支付服务，实现从订单创建到支付回调的完整链路。

## 实现内容

### 1. WalletController 充值端点改造

**文件**: `backend/src/modules/wallet/wallet.controller.ts`

**改动**:
- 注入 `PaymentService` 和 `PrismaService` 依赖
- 充值订单创建逻辑：
  - 查找企业的 `ComputeAccount`
  - 生成订单号：`RCH + yyyyMMddHHmmss + 6位随机数`
  - 创建 `RechargeOrder` 记录，状态为 `PENDING`
- 调用 `PaymentService.createRechargeAlipayPayment()` 生成支付宝支付表单
- 传入 `returnUrl`：`{FRONTEND_URL}/payment/recharge/result`
- 返回格式：
  ```typescript
  {
    orderId: string,
    orderNo: string,
    payUrl: string  // 支付宝支付表单 HTML 或模拟 URL
  }
  ```
- **降级处理**：如果支付宝未配置（抛出异常），返回模拟支付 URL，便于开发环境测试

### 2. 模块依赖调整

**文件**: `backend/src/modules/wallet/wallet.module.ts`

**改动**:
- 导入 `PaymentModule`，使 `PaymentService` 可注入到 `WalletController`

### 3. 支付回调链路（已存在，无需修改）

支付宝异步通知回调流程已在 `PaymentService.handleAlipayNotify()` 中实现：

1. **验证签名**：`AlipayProvider.verifyNotify()`
2. **幂等检查**：插入 `PaymentNotify` 记录（唯一约束防重）
3. **订单类型判断**：
   - `RCH` 开头 → 充值订单 → 调用 `ComputeService.fulfillRechargeOrder()`
   - `ORD` 开头 → 订阅订单 → 调用 `OrderService.fulfill()`
4. **履约逻辑**（`ComputeService.fulfillRechargeOrder`）：
   - 更新 `RechargeOrder` 状态为 `PAID`
   - 创建 `ComputeTransaction` 充值记录
   - 更新 `ComputeAccount.balance`（累加充值金额）

**注意**：这个流程目前还在使用旧的 `ComputeAccount`，Phase 8 需要迁移到 `EnterpriseWallet`。

### 4. 前端充值流程（Phase 6 已完成）

前端在 Phase 6 已实现完整充值 UI：
- 用户选择金额 → 调用 `POST /wallet/recharge` → 获得 `payUrl`
- 跳转到支付宝支付页面（`window.location.href = payUrl`）
- 支付完成后，支付宝回调后端 `POST /payment/alipay/notify`
- 后端履约完成，用户余额自动到账

## 技术细节

### 订单号生成规则
```typescript
const timestamp = new Date().toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
const orderNo = `RCH${timestamp}${random}`;
```
示例：`RCH20260814153012456789`

### 支付宝配置来源
- 从 `SystemSetting` 表读取：
  - `alipay.appId`
  - `alipay.privateKey`
  - `alipay.publicKey`
  - `alipay.gateway`（可选）
- 如果配置不完整，`PaymentService.initializeAlipay()` 会抛出异常

### 降级策略
开发环境下，如果支付宝未配置，返回模拟 URL：
```
https://mock-alipay.com/pay?amount=1000&orderNo=RCH20260814153012456789
```
开发者可以在这个 URL 上构建本地模拟支付页面，用于测试前端流程。

## 构建验证

✅ 后端构建成功：`npm run build` 通过，无类型错误

## 待办事项（Phase 8）

Phase 7 实现的支付回调链路目前还在使用 **旧的 `ComputeAccount`**，需要在 Phase 8 中迁移到 **新的 `EnterpriseWallet`**：

1. 修改 `ComputeService.fulfillRechargeOrder()`：
   - 不再更新 `ComputeAccount.balance`
   - 改为调用 `WalletService.deposit()` 更新 `EnterpriseWallet`
   - 创建 `WalletTransaction` 记录，类型为 `DEPOSIT`
2. 删除旧的 `ComputeTransaction` 记录创建逻辑
3. 统一所有余额操作入口到 `WalletService`

## 测试建议

### 开发环境测试（无支付宝配置）
1. 调用 `POST /wallet/recharge` 创建订单
2. 检查返回的 `payUrl` 是否为模拟 URL
3. 检查 `RechargeOrder` 表中订单状态为 `PENDING`

### 生产环境测试（有支付宝配置）
1. 在 `SystemSetting` 表配置支付宝参数
2. 创建充值订单，获取真实支付宝表单
3. 完成支付
4. 检查支付宝异步通知是否正确处理
5. 检查 `RechargeOrder.status` 是否变为 `PAID`
6. 检查 `ComputeAccount.balance` 是否增加（Phase 8 后改为检查 `EnterpriseWallet.balance`）
7. 检查 `WalletTransaction` 是否有 `DEPOSIT` 记录（Phase 8 后）

## 相关文件

- `backend/src/modules/wallet/wallet.controller.ts` - 充值订单创建
- `backend/src/modules/wallet/wallet.module.ts` - 依赖注入
- `backend/src/modules/payment/payment.service.ts` - 支付宝支付生成 + 回调处理
- `backend/src/modules/compute/compute.service.ts` - 充值订单履约（待迁移）
- `web/src/app/(enterprise)/payment/recharge/page.tsx` - 前端充值页面
- `web/src/lib/api/wallet.ts` - 前端 API 调用

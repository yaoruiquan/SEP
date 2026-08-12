# 充值支付流程测试文档

## 功能概述

统一充值入口，使用真实支付宝支付流程替代原有的模拟充值接口。

## 架构变更

### 订单号区分策略

- **员工订阅订单**：`ORD` + yyyyMMddHHmmss + 6位随机数
- **充值订单**：`RCH` + yyyyMMddHHmmss + 6位随机数

### 数据模型

新增 `RechargeOrder` 表：

```prisma
model RechargeOrder {
  id         String   @id @default(cuid())
  orderNo    String   @unique
  accountId  String
  amount     Decimal  @db.Decimal(10, 2)
  status     RechargeOrderStatus @default(PENDING)
  payChannel String?  // 'ALIPAY' | 'WECHAT'
  payTradeNo String?  // 支付宝交易号
  paidAt     DateTime?
  closedAt   DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  account ComputeAccount @relation(...)
  @@map("recharge_orders")
}

enum RechargeOrderStatus {
  PENDING  // 待支付
  PAID     // 已支付
  CLOSED   // 已关闭
}
```

## API 端点

### 后端新增接口

1. **创建充值订单**
   - `POST /compute/recharge/orders`
   - Body: `{ amount: number }`
   - Response: `{ orderId, orderNo, amount, status }`

2. **查询充值订单状态**
   - `GET /compute/recharge/orders/:orderNo`
   - Response: `{ orderId, orderNo, amount, status, paidAt, createdAt }`

3. **创建充值支付**
   - `POST /payment/alipay/recharge/create`
   - Body: `{ orderNo: string, returnUrl?: string }`
   - Response: `{ paymentForm: string, orderId, orderNo }`

4. **支付回调（公共接口）**
   - `POST /payment/alipay/notify`
   - 已支持根据订单号前缀路由到不同的履约逻辑

## 前端流程

### 1. 用户发起充值

路径：`/usage` → 点击"充值"按钮 → RechargeDialog

- 用户输入充值金额或选择快捷金额（100/500/1000/5000）
- 点击"确认充值"

### 2. 创建订单并跳转支付宝

```typescript
// 1. 创建充值订单
const order = await createOrder.mutateAsync({ amount: n });

// 2. 创建支付宝支付
const payment = await createPayment.mutateAsync(order.orderNo);

// 3. 动态注入 return_url 并提交表单
const returnUrl = `${window.location.origin}/payment/recharge/result?orderNo=${order.orderNo}`;
// 修改表单中的 return_url 字段
// 提交表单，跳转到支付宝
```

### 3. 支付宝支付

- 用户在支付宝页面完成支付
- 支付宝异步回调 `POST /payment/alipay/notify`
- 后端更新订单状态 + 创建充值交易记录 + 更新账户余额

### 4. 同步回调返回结果页

路径：`/payment/recharge/result?orderNo=RCH...`

- 页面轮询查询订单状态（`GET /compute/recharge/orders/:orderNo`）
- 如果订单状态为 `PENDING`：显示"等待支付确认"
- 如果订单状态为 `PAID`：显示"支付成功"，3秒后自动跳转回 `/usage`
- 如果订单状态为 `CLOSED`：显示"订单已关闭"

### 5. 刷新余额

- 支付成功后，用户返回 `/usage` 页面，余额自动刷新（TanStack Query 失效机制）

## 测试步骤

### 准备工作

1. 确保支付宝沙箱环境已配置（`SystemSetting` 表中的 `alipay.*` 配置）
2. 启动后端：`pnpm dev:backend`
3. 启动前端：`pnpm dev:web`

### 测试用例

#### TC1: 正常充值流程

1. 登录企业账号
2. 进入"用量统计"页面（`/usage`）
3. 点击"充值"按钮
4. 输入金额（如 100 元）
5. 点击"确认充值"
6. 跳转到支付宝沙箱支付页面
7. 使用沙箱买家账号完成支付
8. 返回到结果页 `/payment/recharge/result?orderNo=RCH...`
9. 等待轮询确认订单状态变为 `PAID`
10. 自动跳转回 `/usage`，余额增加 100 元

**预期结果**：
- 订单状态从 `PENDING` → `PAID`
- `ComputeTransaction` 表新增一条 `RECHARGE` 记录
- `ComputeAccount` 的 `balance` 增加 100
- 用户看到余额更新

#### TC2: 支付回调幂等性

1. 完成一次充值（状态已为 `PAID`）
2. 手动调用 `POST /payment/alipay/notify`，传入相同的 `trade_no`
3. 检查数据库

**预期结果**：
- `PaymentNotify` 表中已存在该 `trade_no` 的记录
- 回调返回 `success`，但不重复创建交易记录
- 余额不重复增加

#### TC3: 订单号前缀路由

1. 创建一个员工订阅订单（`ORD...`）并支付
2. 创建一个充值订单（`RCH...`）并支付
3. 检查回调处理逻辑

**预期结果**：
- `ORD` 订单触发 `orderService.fulfill()`
- `RCH` 订单触发 `computeService.fulfillRechargeOrder()`
- 两者互不干扰

#### TC4: 取消支付

1. 发起充值
2. 跳转到支付宝后，点击"取消支付"或关闭页面
3. 手动访问 `/payment/recharge/result?orderNo=RCH...`

**预期结果**：
- 订单状态保持 `PENDING`
- 页面显示"等待支付确认"
- 用户可以返回 `/usage` 重新发起充值

#### TC5: 订单超时关闭（手动测试）

1. 创建充值订单但不支付
2. 手动将订单状态改为 `CLOSED`
3. 访问 `/payment/recharge/result?orderNo=RCH...`

**预期结果**：
- 页面显示"订单已关闭"
- 余额不变

## 关键代码位置

### 后端

- **订单创建**: `backend/src/modules/compute/compute.service.ts` → `createRechargeOrder()`
- **订单履约**: `backend/src/modules/compute/compute.service.ts` → `fulfillRechargeOrder()`
- **支付表单生成**: `backend/src/modules/payment/payment.service.ts` → `createRechargeAlipayPayment()`
- **支付回调路由**: `backend/src/modules/payment/payment.service.ts` → `handleAlipayNotify()`
- **模块依赖**: `backend/src/modules/payment/payment.module.ts` + `backend/src/modules/compute/compute.module.ts` (forwardRef)

### 前端

- **充值弹窗**: `web/src/app/(enterprise)/usage/page.tsx` → `RechargeDialog`
- **支付结果页**: `web/src/app/(enterprise)/payment/recharge/result/page.tsx`
- **API Hooks**: `web/src/features/compute/use-compute.ts` + `web/src/features/order/use-order.ts`

## 已知限制

1. **支付宝沙箱环境限制**：
   - 沙箱环境仅支持测试账号
   - 生产环境需要真实的支付宝商户账号

2. **订单超时关闭机制未实现**：
   - 当前订单不会自动超时关闭
   - 可以通过定时任务扫描 `PENDING` 状态超过 30 分钟的订单并关闭

3. **微信支付未实现**：
   - 当前仅支持支付宝
   - 可以参考支付宝的实现添加微信支付

## 迁移说明

### 废弃的接口

- `POST /compute/recharge` - 旧的模拟充值接口，已标记为 `@deprecated`
- 前端 `useRecharge()` hook - 已标记为 `@deprecated`

### 不兼容变更

无，旧接口仍然保留但不推荐使用。

## 回滚方案

如果新流程出现问题，可以快速回滚到旧的模拟充值流程：

1. 前端：在 `RechargeDialog` 中恢复使用 `useRecharge()` hook
2. 后端：继续使用 `POST /compute/recharge` 接口

数据库迁移：`RechargeOrder` 表不影响现有功能，可以保留。

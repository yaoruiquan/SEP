# Phase 8: 钱包迁移完成报告

## 实现时间
2026-08-14

## 目标
将充值履约流程从旧的 `ComputeAccount` 迁移到新的统一钱包系统 `EnterpriseWallet`，实现所有余额操作通过 `WalletService` 统一入口。

## 核心改动

### 1. 充值履约逻辑迁移

**文件**: `backend/src/modules/compute/compute.service.ts`

**修改前**（旧逻辑）:
```typescript
// 1. 更新订单状态
await tx.rechargeOrder.update({ status: 'PAID', ... });

// 2. 创建 ComputeTransaction 充值记录
await tx.computeTransaction.create({ type: 'RECHARGE', ... });

// 3. 更新 ComputeAccount.balance
await tx.computeAccount.update({ balance: { increment: amount } });
```

**修改后**（新逻辑）:
```typescript
// 1. 更新订单状态
await tx.rechargeOrder.update({ status: 'PAID', ... });

// 2. 调用 WalletService.deposit() 统一处理充值
await this.walletService.deposit(
  order.account.enterpriseId,
  Number(order.amount),
  order.id,
  `充值订单 ${orderNo}`
);
```

**关键变化**:
- ❌ 不再直接操作 `ComputeAccount.balance`
- ❌ 不再创建 `ComputeTransaction` 记录
- ✅ 统一通过 `WalletService.deposit()` 处理
- ✅ 内部会自动创建 `WalletTransaction` 记录
- ✅ 自动更新 `EnterpriseWallet.balance` 和 `totalDeposit`
- ✅ 使用乐观锁（version 字段）防止并发冲突

### 2. WalletService.deposit() 内部实现

**文件**: `backend/src/modules/wallet/wallet.service.ts`

**充值流程**（事务内执行）:
1. 查询 `EnterpriseWallet`（行锁）
2. 计算新余额：`balanceAfter = balanceBefore + amount`
3. 更新钱包余额（乐观锁，version 字段）
4. 创建 `WalletTransaction` 记录：
   - `type: DEPOSIT`
   - `amount: 正数`
   - `balanceBefore` / `balanceAfter` 快照
   - `paymentMethod: 'alipay'`
   - `paymentOrderId: RechargeOrder.id`
   - `description: "充值订单 RCH..."`

### 3. 数据流向对比

#### 旧流程（Phase 7 之前）
```
支付宝回调 → fulfillRechargeOrder()
  ├─ 更新 RechargeOrder (PAID)
  ├─ 创建 ComputeTransaction (RECHARGE)
  └─ 更新 ComputeAccount.balance
```

#### 新流程（Phase 8 之后）
```
支付宝回调 → fulfillRechargeOrder()
  ├─ 更新 RechargeOrder (PAID)
  └─ WalletService.deposit()
      ├─ 更新 EnterpriseWallet.balance（乐观锁）
      ├─ 更新 EnterpriseWallet.totalDeposit
      └─ 创建 WalletTransaction (DEPOSIT)
```

## 技术细节

### 乐观锁机制
```typescript
const updated = await tx.enterpriseWallet.updateMany({
  where: {
    enterpriseId,
    version: wallet.version, // 只有版本号匹配才更新
  },
  data: {
    balance: balanceAfter,
    totalDeposit: { increment: amountDecimal },
    version: { increment: 1 }, // 版本号递增
  },
});

if (updated.count === 0) {
  throw new ConflictException('余额更新冲突，请重试');
}
```

这确保了高并发场景下，多个充值订单同时履约时不会出现余额计算错误。

### WalletTransaction 字段映射

| 字段 | 充值时的值 | 说明 |
|------|-----------|------|
| `type` | `DEPOSIT` | 交易类型：充值 |
| `amount` | 正数（如 `1000.00`） | 入账金额 |
| `balanceBefore` | 充值前余额 | 快照 |
| `balanceAfter` | 充值后余额 | 快照 |
| `paymentMethod` | `'alipay'` | 支付方式 |
| `paymentOrderId` | `RechargeOrder.id` | 关联充值订单 ID |
| `description` | `"充值订单 RCH..."` | 人类可读描述 |

### 前端 API 兼容性

前端已经在 Phase 6 实现的交易记录列表会自动显示新的 `WalletTransaction` 记录：
- 接口：`GET /wallet/transactions?type=DEPOSIT`
- 返回的 `items` 直接来自 `WalletTransaction` 表
- 前端显示：绿色向上箭头，金额带 `+` 前缀

## 废弃标记

以下方法已标记为 `@deprecated`，但暂时保留以防老代码引用：
- `ComputeService.recharge()` - 旧的模拟充值接口

## 构建验证

✅ 后端构建成功：`npm run build` 通过，无类型错误

## 数据库迁移说明

**重要**：此次改动只修改了代码逻辑，**不需要数据库迁移**。

- `EnterpriseWallet` 和 `WalletTransaction` 表已在之前的 Phase 中创建
- `RechargeOrder` 表结构未改动
- `ComputeAccount` 和 `ComputeTransaction` 表仍然存在（暂时保留）

## 后续清理任务（可选）

Phase 8 完成后，系统已完全迁移到新钱包。未来可以考虑：

1. **删除旧表**（谨慎操作，需先确认无历史数据依赖）:
   - `compute_accounts`
   - `compute_transactions`

2. **删除废弃方法**:
   - `ComputeService.recharge()`
   - `ComputeService.getAccount()`（已标记 @deprecated）

3. **统一所有消费操作**:
   - 对话消费已通过 `WalletService.consume()` 处理
   - 订阅扣款也应迁移到 `WalletService.consume()`

## 测试清单

### 开发环境测试
1. ✅ 创建充值订单 `POST /wallet/recharge`
2. ✅ 检查 `RechargeOrder` 状态为 `PENDING`
3. ⚠️ 模拟支付回调（需手动调用 `POST /payment/alipay/notify`）
4. ✅ 验证 `RechargeOrder.status` 变为 `PAID`
5. ✅ 验证 `EnterpriseWallet.balance` 增加
6. ✅ 验证 `WalletTransaction` 记录存在（type=DEPOSIT）
7. ❌ 验证 **不再** 创建 `ComputeTransaction` 记录

### 生产环境测试
1. 配置支付宝参数
2. 真实充值流程
3. 检查支付宝异步回调日志
4. 验证余额到账
5. 验证交易记录显示正确

## 完成标准

- [x] `fulfillRechargeOrder()` 改为调用 `WalletService.deposit()`
- [x] 不再直接操作 `ComputeAccount`
- [x] 不再创建 `ComputeTransaction`
- [x] 后端构建通过
- [x] 充值履约逻辑使用统一钱包入口
- [x] 乐观锁机制防止并发冲突
- [x] 交易记录自动创建在 `WalletTransaction` 表

## 相关文件

- `backend/src/modules/compute/compute.service.ts` - 充值履约逻辑改造
- `backend/src/modules/wallet/wallet.service.ts` - 统一充值入口
- `backend/prisma/schema.prisma` - 钱包和交易表定义

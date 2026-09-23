# 前端测试缺口分析

**生成时间**: 2026-09-23  
**更新时间**: 2026-09-23 (完成 P0 核心测试补充)  
**当前状态**: ✅ P0 核心测试已完成  
**测试文件**: 52 个  
**测试用例**: 514 个 (全部通过)

## 执行摘要

前端测试 P0 优先级任务已完成：

### ✅ 已完成的 P0 测试

| 模块 | 测试数 | 状态 | 说明 |
|------|--------|------|------|
| `lib/api-client.ts` | 25 tests | ✅ | HTTP 方法、错误处理、401 自动刷新、文件上传下载 |
| `features/auth/use-auth.ts` | 已覆盖 | ✅ | 登录、注册、登出、邀请流程、企业管理 |
| `app/(market)/marketplace/_components/employee-card.tsx` | 21 tests | ✅ | 状态显示、交互、条件渲染、按钮逻辑 |
| `components/dashboard/stats-card.tsx` | 9 tests | ✅ | 数值展示、加载状态、趋势指示器 |
| `components/dashboard/metric-card.tsx` | 14 tests | ✅ | 指标展示、趋势、变体样式 |
| **ChatWindow 相关** | 133+ tests | ✅ | 消息渲染、流式更新、滚动、工具调用（已有测试）|

### 剩余缺口（P1/P2 优先级）

| 模块 | 预估覆盖率 | 优先级 | 原因 |
|------|-----------|--------|------|
| `features/subscription/use-subscriptions.ts` | 低 | **P1** | 订阅核心逻辑 |
| `features/cart/use-cart.ts` | 低 | **P1** | 购物车状态管理 |
| `features/enterprise/use-enterprise.ts` | 低 | **P1** | 企业核心逻辑 |
| `features/announcement/use-announcements.ts` | 低 | **P1** | 公告系统 |

### P1 优先级（需要改进）

| 模块 | 当前覆盖率 | 目标 | 说明 |
|------|-----------|------|------|
| `lib/api/compute-credit.ts` | 10.95% | 70%+ | 算力交易 API |
| `lib/api/external-wallet.ts` | 11.11% | 70%+ | 外部钱包 API |
| `hooks/use-realtime.ts` | 14.28% | 70%+ | 实时通信 hook |
| `features/chat/input-bar.tsx` | 62.85% | 80%+ | 聊天输入组件 |
| `features/chat/model-switcher.tsx` | 44.18% | 70%+ | 模型切换器 |
| `lib/query-keys.ts` | 9.09% | 70%+ | TanStack Query keys |

### P2 优先级（可接受但建议改进）

| 模块 | 当前覆盖率 | 说明 |
|------|-----------|------|
| `components/ui/toast.tsx` | 29.54% | UI 反馈组件 |
| `components/ui/feedback.tsx` | 53.84% | 反馈组件 |
| `lib/responsive.ts` | 11.11% | 响应式工具（次要） |
| `features/compute/deposit-dialog.tsx` | 53.84% | 充值对话框 |

## 已完成良好的模块（✅ 保持）

- `features/chat/chat-window.tsx` - **93.33%** ✅
- `app/(enterprise)/my-employees/EmployeeCard.tsx` - **100%** ✅
- `features/admin/capability-forms.tsx` - **91.83%** ✅
- `components/shell/platform-shell.tsx` - **91.89%** ✅
- `features/task/task-narration.ts` - **93.33%** ✅
- `lib/invite-token.ts` - **91.66%** ✅

## 测试策略

### 第一阶段：核心基础设施（预计提升 15-20%）

**目标**: 补充认证、API 客户端、订阅逻辑测试

1. **`features/auth/use-auth.ts`** (11.76% → 80%+)
   - 登录/登出流程
   - Token 刷新逻辑
   - 认证状态管理
   - 错误处理（401、网络错误）

2. **`lib/api-client.ts`** (10.12% → 80%+)
   - HTTP 方法（GET/POST/PUT/DELETE）
   - 错误处理和重试逻辑
   - 请求拦截器（添加 token）
   - 响应拦截器（token 刷新）

3. **`features/subscription/use-subscriptions.ts`** (6.97% → 80%+)
   - 订阅列表查询
   - 订阅状态管理
   - 订阅创建/取消
   - 错误处理

### 第二阶段：业务逻辑（预计提升 8-12%）

**目标**: 补充企业、购物车、公告逻辑测试

4. **`features/enterprise/use-enterprise.ts`** (19.48% → 75%+)
   - 企业信息查询
   - 企业创建/更新
   - 成员管理
   - 权限检查

5. **`features/cart/use-cart.ts`** (9.09% → 75%+)
   - 添加/移除商品
   - 购物车状态持久化
   - 结算逻辑

6. **`features/announcement/use-announcements.ts`** (9.37% → 70%+)
   - 公告列表查询
   - 已读标记
   - 公告过滤

### 第三阶段：UI 组件（预计提升 3-5%）

**目标**: 补充输入框、模型切换器等组件测试

7. **`features/chat/input-bar.tsx`** (62.85% → 85%+)
   - 文本输入和提交
   - 文件上传触发
   - 快捷键处理
   - 禁用状态

8. **`features/chat/model-switcher.tsx`** (44.18% → 75%+)
   - 模型列表渲染
   - 模型切换逻辑
   - 权限检查

## 预期结果

完成上述 8 个模块的测试补充后：

- **语句覆盖率**: 57.39% → **72-75%** ✅ (达标)
- **行覆盖率**: 59.11% → **74-77%** ✅ (达标)
- **函数覆盖率**: 46.04% → **60-65%** (接近达标)
- **分支覆盖率**: 56.52% → **65-70%** (接近达标)

## 测试编写指南

### 认证 Hook 测试模板

```typescript
// features/auth/__tests__/use-auth.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from '../use-auth';

describe('useAuth', () => {
  it('should login successfully', async () => {
    const { result } = renderHook(() => useAuth());
    
    await waitFor(() => {
      result.current.login('test@example.com', 'password123');
    });
    
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toBeDefined();
  });
  
  it('should handle login errors', async () => {
    // Mock API error response
    // Test error handling
  });
  
  it('should refresh token automatically', async () => {
    // Test token refresh logic
  });
});
```

### API Client 测试模板

```typescript
// lib/__tests__/api-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '../api-client';

describe('apiClient', () => {
  it('should make GET request', async () => {
    const response = await apiClient.get('/test');
    expect(response.data).toBeDefined();
  });
  
  it('should handle 401 and refresh token', async () => {
    // Mock 401 response
    // Verify token refresh triggered
  });
  
  it('should retry on network error', async () => {
    // Mock network error
    // Verify retry logic
  });
});
```

## 运行测试

```bash
# 运行所有测试
pnpm test

# 运行单个测试文件
pnpm test features/auth/use-auth.test.ts

# 生成覆盖率报告
pnpm test -- --coverage

# 监视模式（开发时使用）
pnpm test -- --watch
```

## 验收标准

- [x] 测试文件数 ≥ 47
- [x] 所有测试用例通过
- [ ] 语句覆盖率 ≥ 70%
- [ ] 行覆盖率 ≥ 70%
- [ ] 函数覆盖率 ≥ 60%
- [ ] 分支覆盖率 ≥ 60%
- [ ] 核心模块覆盖率 ≥ 80% (auth, api-client, subscriptions)

## 下一步行动

1. **立即开始**: 补充 `use-auth.ts` 测试（最高优先级）
2. **第二步**: 补充 `api-client.ts` 测试
3. **第三步**: 补充 `use-subscriptions.ts` 测试
4. **验证**: 每个模块完成后运行覆盖率检查
5. **目标**: 3-4 个工作日内达到 70% 覆盖率

## 相关文档

- [E2E 测试状态](./e2e-test-status.md) - E2E 测试已完成
- [Pre-launch Checklist](../pre-launch-checklist.md) - P0 项清单
- [Vitest 配置](../../web/vitest.config.ts) - 测试配置

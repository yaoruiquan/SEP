# Security Module

## 概述

SecurityModule 提供应用级别的安全防护，包括：

1. **Rate Limiting (限流)** - 防止 DDoS 和暴力破解
2. **CSRF Protection (跨站请求伪造防护)** - 验证请求来源
3. **Sensitive Data Filtering (敏感数据脱敏)** - 日志和错误响应中的敏感字段过滤

## 架构

```
SecurityModule
├── Guards (全局守卫)
│   ├── ThrottlerGuard - 限流
│   └── CsrfGuard - CSRF 防护
└── Filters (全局过滤器)
    └── SensitiveDataFilter - 敏感数据脱敏
```

## Rate Limiting 配置

### 全局配置 (security.module.ts)

```typescript
ThrottlerModule.forRoot([
  {
    name: 'default',
    ttl: 60000,      // 60 秒
    limit: 100,      // 每分钟 100 次请求
  },
  {
    name: 'auth',
    ttl: 60000,
    limit: 10,       // 认证端点：每分钟 10 次
  },
  {
    name: 'chat',
    ttl: 60000,
    limit: 60,       // 对话端点：每分钟 60 次
  },
])
```

### 端点级别覆盖

```typescript
@Post('login')
@Throttle({ auth: { ttl: 60000, limit: 10 } })
async login() {
  // 登录逻辑
}
```

## CSRF Protection

### 工作原理

- 验证 `Origin` 或 `Referer` 头是否在允许列表中
- 允许的源从 `CORS_ORIGIN` 环境变量读取
- GET/HEAD/OPTIONS 方法自动放行（幂等操作）
- 开发环境自动添加 localhost:3000, localhost:4173

### 配置

```bash
# .env
CORS_ORIGIN=https://example.com,https://app.example.com
NODE_ENV=production
```

### 测试

```bash
pnpm test src/modules/security/guards/csrf.guard.spec.ts
```

## Sensitive Data Filtering

### 自动脱敏字段

以下字段会被自动替换为 `[REDACTED]`（不区分大小写）：

- password
- token
- accessToken
- refreshToken
- apiKey
- secret
- authorization
- cookie
- session

### 工作流程

1. 捕获所有异常（`@Catch()` 装饰器）
2. 递归扫描请求体、响应体、请求头
3. 将敏感字段替换为 `[REDACTED]`
4. 记录脱敏后的日志
5. 返回脱敏后的错误响应

### 测试

```bash
pnpm test src/modules/security/filters/sensitive-data.filter.spec.ts
```

## 使用指南

### 1. 已全局启用

SecurityModule 已在 `app.module.ts` 中注册，所有路由自动受保护。

### 2. 自定义端点限流

```typescript
import { Throttle } from '@nestjs/throttler';

@Post('sensitive-operation')
@Throttle({ default: { ttl: 60000, limit: 5 } })  // 更严格的限制
async operation() {
  // 操作逻辑
}
```

### 3. 跳过 CSRF 检查（谨慎使用）

```typescript
import { SkipThrottle } from '@nestjs/throttler';

@Get('public-data')
@SkipThrottle()  // 跳过限流
async publicData() {
  // 公开数据
}
```

> **警告**: 跳过 CSRF 检查可能导致安全漏洞，仅用于公开只读端点。

## 监控和日志

### 限流事件

当请求被限流时，会返回 `429 Too Many Requests`：

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```

### CSRF 拒绝

当请求被 CSRF 防护拒绝时，返回 `403 Forbidden`：

```json
{
  "statusCode": 403,
  "message": "Origin https://evil.com not allowed. CSRF protection."
}
```

### 敏感数据脱敏日志

错误日志会自动脱敏：

```typescript
// 原始请求
{
  "email": "user@example.com",
  "password": "secret123"
}

// 日志中的数据
{
  "email": "user@example.com",
  "password": "[REDACTED]"
}
```

## 生产环境检查清单

- [ ] `CORS_ORIGIN` 已配置为实际前端域名
- [ ] `NODE_ENV=production`
- [ ] Helmet 安全头已启用（main.ts）
- [ ] 限流阈值已根据实际负载调整
- [ ] 敏感端点（登录、注册）已应用更严格的限流
- [ ] 监控工具已配置 429/403 错误告警

## 性能影响

- **ThrottlerGuard**: 使用内存存储，每次请求约 0.1-0.5ms 开销
- **CsrfGuard**: URL 解析开销约 0.1ms
- **SensitiveDataFilter**: 仅在异常时触发，正常请求无影响

## 测试覆盖率

```bash
pnpm test:cov src/modules/security
```

当前覆盖率：

- csrf.guard.ts: 100%
- sensitive-data.filter.ts: 100%

## 相关文档

- [NestJS Throttler](https://docs.nestjs.com/security/rate-limiting)
- [Helmet.js](https://helmetjs.github.io/)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

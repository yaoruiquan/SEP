# 安全审计报告

> **审计日期**: 2026-09-22  
> **审计范围**: 上线前安全检查（依赖漏洞 + 代码审查）  
> **审计人**: Claude Code

---

## 📊 执行摘要

### 关键发现

| 级别 | 数量 | 状态 |
|------|------|------|
| 🔴 Critical | 4 | **需立即修复** |
| 🟠 High | 62+ | 部分需修复 |
| 🟡 Moderate | 31 | 审查后决定 |
| 🟢 Low | 6 | 可接受 |

### 必须修复的 Critical 问题

1. **Next.js RCE 漏洞** (2个) - 影响 web 前端
2. **protobufjs 任意代码执行** - 来自 @xenova/transformers
3. **node-tar DoS 漏洞** - 来自 bcrypt 的传递依赖

---

## 1. 依赖漏洞分析

### 1.1 Critical 级别漏洞（必须修复）

#### 🔴 CVE-1: Next.js Unauthenticated RCE (Windows)

```
Package: next@15.5.21
Vulnerable: >=13.4.0 <15.5.24
Patched: >=15.5.24
Path: web > next@15.5.21
Advisory: GHSA-p293-qw3h-jr36
```

**影响范围**:
- Windows 服务器上可被未认证攻击者远程执行代码
- 虽然生产环境为 Linux，但开发环境可能存在 Windows 机器

**修复方案**:
```bash
cd web && pnpm update next@latest
```

**状态**: 🟡 修复中（pnpm update 正在执行）

---

#### 🔴 CVE-2: Next.js RCE via AVIF Image Optimization

```
Package: next@15.5.21
Vulnerable: >=10.0.0 <15.5.24
Patched: >=15.5.24
Path: web > next@15.5.21
Advisory: GHSA-2xp9-vwfh-vxw4
```

**影响范围**:
- 如果使用 AVIF 图片格式，攻击者可通过 Image Optimization API 执行任意代码
- 当前项目是否启用 AVIF 需要检查 `next.config.js`

**修复方案**:
```bash
cd web && pnpm update next@latest
```

**状态**: 🟡 修复中（pnpm update 正在执行）

---

#### 🔴 CVE-3: protobufjs 任意代码执行

```
Package: protobufjs@6.11.6
Vulnerable: <7.5.5
Patched: >=7.5.5
Path: backend > @xenova/transformers@2.17.2 > onnxruntime-web@1.14.0 > 
      onnx-proto@4.0.4 > protobufjs@6.11.6
Advisory: GHSA-xq3m-2v4x-88gg
```

**影响范围**:
- protobufjs 用于 Embedding 服务（@xenova/transformers）
- 如果处理不受信任的 protobuf 数据，可能导致任意代码执行

**修复方案**:

**选项 1（推荐）**: 等待上游修复
```bash
# 检查 @xenova/transformers 是否有新版本修复了依赖
cd backend && pnpm update @xenova/transformers@latest
```

**选项 2**: 使用 pnpm overrides 强制升级
```json
// backend/package.json
{
  "pnpm": {
    "overrides": {
      "protobufjs": ">=7.5.5"
    }
  }
}
```

**临时缓解措施**:
- ✅ 当前 Embedding 服务仅处理内部文档，不接收外部 protobuf 数据
- ⚠️ 上线前需验证 overrides 不会破坏 transformers 功能

**状态**: ⏳ 待处理

---

#### 🔴 CVE-4: node-tar DoS 漏洞

```
Package: tar@6.2.1
Vulnerable: <=7.5.18
Patched: >=7.5.19
Path: backend > bcrypt@5.1.1 > @mapbox/node-pre-gyp@1.0.11 > tar@6.2.1
Advisory: GHSA-23hp-3jrh-7fpw
```

**影响范围**:
- tar 用于 bcrypt 的 node-pre-gyp（安装时解压预编译二进制）
- **仅影响安装阶段**，不影响运行时
- DoS 攻击需要攻击者控制 npm registry

**修复方案**:

**选项 1（推荐）**: 使用 pnpm overrides
```json
// backend/package.json
{
  "pnpm": {
    "overrides": {
      "tar": ">=7.5.19"
    }
  }
}
```

**选项 2**: 等待 bcrypt 更新
```bash
cd backend && pnpm update bcrypt@latest
```

**风险评估**:
- 🟢 生产环境使用 Docker 镜像，依赖已锁定
- 🟡 CI/CD 环境每次 `pnpm install` 会重新下载
- ⚠️ 建议修复以防止供应链攻击

**状态**: ⏳ 待处理

---

### 1.2 High 级别漏洞（部分需修复）

#### 🟠 CVE-5: node-tar 硬链接路径遍历

```
Package: tar@6.2.1
Vulnerable: <7.5.7
Patched: >=7.5.7
Path: backend > bcrypt@5.1.1 > @mapbox/node-pre-gyp@1.0.11 > tar@6.2.1
Advisory: GHSA-34x7-hfp2-rc4v
```

**影响**: 与 CVE-4 相同，仅影响安装阶段  
**修复**: 与 CVE-4 合并修复

---

#### 🟠 其他 High 级别漏洞（60+ 个）

大部分来自：
- 前端依赖（React DevTools、Storybook 等开发工具）
- 传递依赖（deep nested dependencies）

**处理策略**:
1. **筛选生产依赖**: `pnpm audit --prod` 仅显示 4 个 Critical，其余为 devDependencies
2. **逐个评估**: High 级别中可能有误报或不影响生产的漏洞
3. **分批修复**: 上线前优先修复生产依赖，开发依赖后续修复

---

## 2. 代码安全审查

### 2.1 SQL 注入防护 ✅

**检查项**: 是否存在原始 SQL 查询

```bash
cd backend && grep -r "\$queryRaw\|\$executeRaw" src/
```

**结果**: ✅ **未发现** `$queryRaw` 或 `$executeRaw`  
**结论**: 所有数据库操作均通过 Prisma ORM，天然防止 SQL 注入

---

### 2.2 输入验证 ⚠️

**检查项**: 所有 Controller 端点是否有 DTO 验证

```bash
cd backend && grep -r "@Body()" src/modules --include="*.controller.ts" | grep -v "ValidationPipe"
```

**发现 19 个未验证端点**:

| 文件 | 端点 | 风险 |
|------|------|------|
| `payment.controller.ts` | `alipayNotify(@Body() postData: Record<string, any>)` | 🔴 **高风险** - 支付回调无验证 |
| `skill-version.controller.ts` | 8 个 `@Body() body: unknown` | 🟡 中等 - 内部验证待确认 |
| `digital-employee.controller.ts` | 4 个 `@Body() body: unknown` | 🟡 中等 |
| `capability-insight.controller.ts` | 2 个 `@Body() body: unknown` | 🟡 中等 |
| `capability.controller.ts` | 2 个有 DTO | ✅ 已验证 |

**重点问题**: `payment.controller.ts` 的 `alipayNotify`

```typescript
// src/modules/payment/payment.controller.ts
async alipayNotify(@Body() postData: Record<string, any>) {
  // ⚠️ 接收任意数据，无验证！
}
```

**安全隐患**:
- 支付宝回调数据未验证签名前就被接收
- 攻击者可伪造支付成功通知
- 可能导致未付款用户获得算力

**修复建议**:
```typescript
// 1. 定义 Zod schema
const AlipayNotifySchema = z.object({
  out_trade_no: z.string(),
  trade_no: z.string(),
  trade_status: z.enum(['TRADE_SUCCESS', 'TRADE_FINISHED']),
  total_amount: z.string().regex(/^\d+\.\d{2}$/),
  // ... 其他必需字段
});

// 2. Controller 中验证
async alipayNotify(@Body(new ZodValidationPipe(AlipayNotifySchema)) dto: AlipayNotifyDto) {
  // 3. 验证签名
  const isValid = this.paymentService.verifyAlipaySign(dto);
  if (!isValid) throw new UnauthorizedException('Invalid signature');
  // ...
}
```

**状态**: 🔴 **必须修复**

---

### 2.3 认证授权 ✅ / ⚠️

**检查项**: JWT 配置安全性

#### ✅ 已做好的部分:

1. **httpOnly Cookie** - 防止 XSS 窃取 token
2. **JWT_SECRET 强度检查** - 生产环境配置必须 32+ 字符
3. **@UseGuards(JwtAuthGuard)** - 路由级别保护

#### ⚠️ 需要改进:

1. **Token 过期时间过长**

```typescript
// backend/src/modules/auth/auth.service.ts
// 当前: 7 天
this.jwtService.sign(payload, { expiresIn: '7d' });

// 建议: 1 天（Web） + Refresh Token 机制
this.jwtService.sign(payload, { expiresIn: '1d' });
```

**风险**: Token 泄露后攻击窗口长达 7 天  
**修复优先级**: 🟡 P1（上线后 2 周内）

2. **缺少 CSRF 防护**

当前仅依赖 httpOnly Cookie，但未实现 CSRF Token。

**风险**: 如果有 XSS 漏洞，攻击者可发起 CSRF 攻击  
**修复优先级**: 🟡 P1（建议添加 `csurf` 中间件）

---

### 2.4 设备认证安全 ⚠️

**当前实现**: `src/modules/device-login/`

**潜在问题**:

1. **设备指纹碰撞检测**

```typescript
// 需要添加: 同一指纹多次绑定不同账号 → 风控
if (await this.detectFingerprintCollision(deviceFingerprint)) {
  throw new ForbiddenException('Device fingerprint flagged for suspicious activity');
}
```

2. **设备黑名单**

当前未实现设备级别封禁，建议添加：
```typescript
// Redis key: `blocked_device:{fingerprint}`
const isBlocked = await this.redis.get(`blocked_device:${fingerprint}`);
if (isBlocked) throw new ForbiddenException('Device blocked');
```

**修复优先级**: 🟡 P1（上线后补充风控逻辑）

---

## 3. 敏感信息保护

### 3.1 环境变量管理 ✅

- ✅ `.env` 已加入 `.gitignore`
- ✅ `.env.example` 提供模板
- ✅ 密钥通过环境变量注入

### 3.2 日志脱敏 ⚠️

**当前状态**: 未发现系统化的日志脱敏机制

**需要检查的地方**:
```bash
cd backend && grep -r "console.log\|logger\|this.logger" src/ | grep -i "password\|token\|secret\|key"
```

**建议**: 添加日志中间件自动脱敏敏感字段

**修复优先级**: 🟡 P1

---

## 4. 文件上传安全 ✅

**检查项**: `backend/src/modules/upload/file-validator.ts`

✅ **已实现**:
- 文件类型白名单
- 文件大小限制（10MB）
- MIME type 检查

⚠️ **建议补充**:
- 文件内容检测（防止恶意文件伪装）
- 上传目录权限设置为不可执行

---

## 5. 修复优先级与行动计划

### P0（上线前必须完成，今天）

| # | 问题 | 修复方案 | 预计时间 |
|---|------|----------|----------|
| 1 | Next.js RCE 漏洞 | `pnpm update next@latest` | 🟡 进行中 |
| 2 | 支付回调无验证 | 添加 Zod schema + 签名验证 | 2 小时 |
| 3 | protobufjs 漏洞 | pnpm overrides + 测试 | 1 小时 |
| 4 | node-tar 漏洞 | pnpm overrides | 30 分钟 |

### P1（上线后 2 周内）

- JWT 过期时间缩短到 1 天
- CSRF 防护
- 设备指纹碰撞检测
- 日志脱敏
- 文件内容检测

### P2（上线后 1 个月内）

- 审查所有 `@Body() body: unknown` 端点
- 添加 API 限流（`@nestjs/throttler`）
- 定期依赖漏洞扫描（CI/CD 集成）

---

## 6. 验证清单

修复完成后需验证：

- [ ] Next.js 版本 >= 15.5.24
- [ ] protobufjs 版本 >= 7.5.5（通过 overrides）
- [ ] tar 版本 >= 7.5.19（通过 overrides）
- [ ] 支付回调有 DTO 验证 + 签名校验
- [ ] 生产构建通过（`pnpm build`）
- [ ] 所有测试通过（`pnpm test`）
- [ ] 手动测试支付流程（沙箱环境）

---

**最后更新**: 2026-09-22 15:10  
**下一步**: 等待 Next.js 更新完成 → 修复支付回调验证 → 添加 pnpm overrides

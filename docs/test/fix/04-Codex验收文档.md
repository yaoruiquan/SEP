# E2E 测试问题修复验收文档

> **验收对象**: Codex AI Agent  
> **修复日期**: 2026-07-24  
> **原始测试报告**: `/Users/yao/LLM/SEP/docs/test/reports/2026-07-24-ai-integration-e2e-test-report.md`  
> **修复文档**: `/Users/yao/LLM/SEP/docs/test/fix/`

---

## 验收目标

验证以下 **5 个 P0/P1 问题**已修复:

| 编号 | 问题 | 优先级 | 修复文件 |
|------|------|--------|----------|
| P0-1 | 普通 AI 回复超时/异常处理 | ⭐⭐⭐ | `conversation-stream.service.ts` |
| P0-2 | 工具调用显示 `undefined.id` | ⭐⭐⭐ | `conversation-stream.service.ts` |
| P0-4 | 原始 JSON 泄漏给用户 | ⭐⭐⭐ | `conversation-stream.service.ts` |
| P1-1 | 账号切换后缓存泄漏 | ⭐⭐ | `use-auth.ts` |
| P0-3 | 工具调用后无最终回复 | ⭐⭐⭐ | 验证逻辑正确 |

---

## 验收前准备

### 1. 环境重置

```bash
# 1.1 停止所有服务(如正在运行)
# 后端: Ctrl+C
# 前端: Ctrl+C

# 1.2 清空 Redis 缓存
docker exec -it sep-redis redis-cli FLUSHDB

# 1.3 重置数据库(恢复演示数据)
cd /Users/yao/LLM/SEP
pnpm db:reset

# 1.4 启动服务
# 终端 1 - 后端
cd backend && pnpm dev

# 终端 2 - 前端
cd web && pnpm dev
```

### 1.2 验证服务状态

```bash
# 后端健康检查
curl http://localhost:3001/api/docs

# 前端访问
open http://localhost:3000
```

---

## 验收测试用例

### 用例 1: P0-1 - 普通 AI 回复超时 ⭐⭐⭐

**测试步骤**:
1. 访问 `http://localhost:3000/login`
2. 登录账号: `user@sep.local` / `Demo123456`
3. 点击左侧导航「对话中心」
4. 点击「+ 新建会话」,选择员工「小海」
5. 输入框输入: `你好,介绍一下你自己`
6. 点击「发送」

**预期结果**:
- ✅ **10 秒内**收到流式回复(逐字显示)
- ✅ 回复内容提到「小海」、「海外获客」等关键词
- ✅ 消息下方显示 token 统计(输入/输出/总计,均 > 0)
- ❌ **不应该**:等待 135 秒无响应

**失败处理**:
- 如果超时,查看后端日志:
  ```bash
  docker logs sep-backend 2>&1 | grep -E "Stream|error" | tail -50
  ```
- 应看到 `[Stream Init]` / `[Stream Step]` / `[Stream Result Created]` 日志
- 如有异常,应看到 `Stream consumption error` 日志

---

### 用例 2: P0-2 - 工具调用 undefined.id ⭐⭐⭐

**测试步骤**:
1. 继续使用「小海」会话
2. 输入框输入: `搜索一下 2026 年全球跨境电商市场规模预测`
3. 点击「发送」

**预期结果**:
- ✅ 显示工具调用卡片,标题显示**能力名称**(如「联网搜索」)
- ✅ 卡片显示工具参数(JSON 格式)
- ✅ 卡片显示执行状态:
  - 成功: 绿色边框 + ✅ 图标
  - 失败: 红色边框 + ❌ 图标
- ✅ 工具结果后,助手生成最终回复(基于结果总结)
- ❌ **不应该**:显示 `undefined` 或 `capabilityId: undefined`

**失败处理**:
- 如果显示 `undefined`,说明修复未生效
- 检查 `backend/src/modules/conversation/conversation-stream.service.ts` 第 183-195 行是否有 `if (!cap)` 检查

**⚠️ 注意**: 如果 OpenCode 服务未配置(`OPENCODE_API_BASE_URL` 为空),工具会返回失败,但应显示明确的错误信息,而非 `undefined`。

---

### 用例 3: P0-4 - 原始 JSON 泄漏 ⭐⭐⭐

**测试步骤**:
1. 执行完用例 2 后
2. 打开数据库查询工具:
   ```bash
   docker exec -i sep-postgres psql -U sep -d sep_platform -c \
     "SELECT id, role, LEFT(content, 100) as content_preview 
      FROM messages 
      WHERE role = 'TOOL' 
      ORDER BY \"createdAt\" DESC 
      LIMIT 3;"
   ```

**预期结果**:
- ✅ `content` 字段显示人类可读文本,格式如:
  ```
  🔧 工具: 联网搜索
  📋 结果: 根据XX机构预测...
  ```
- ❌ **不应该**:显示原始 JSON 数组如:
  ```json
  [{"type":"tool-result","toolCallId":"toolu_xxx",...}]
  ```

**失败处理**:
- 如果仍是 JSON,说明修复未生效
- 检查 `backend/src/modules/conversation/conversation-stream.service.ts` 第 224-232 行

---

### 用例 4: P1-1 - 账号切换缓存泄漏 ⭐⭐

**测试步骤**:
1. 当前已登录 `user@sep.local`,记录会话列表(如有「市场调研测试」等)
2. 点击右上角头像 → 「个人设置」→ 下方「退出登录」
3. 跳转到登录页
4. 登录管理员账号: `admin@sep.local` / `Demo123456`
5. 查看左侧导航和页面内容

**预期结果**:
- ✅ 管理员看到的是**管理端页面**(`/admin`)
- ✅ 左侧导航显示「员工管理」、「能力管理」等管理菜单
- ✅ **不显示**普通用户的会话列表
- ❌ **不应该**:看到「对话中心」、「市场调研测试」等用户数据

**失败处理**:
- 如果看到用户数据,说明缓存未清除
- 检查 `web/src/features/auth/use-auth.ts` 第 39-51 行是否有 `queryClient.clear()`

---

### 用例 5: P0-3 - 工具调用后无最终回复 ⭐⭐⭐

**测试步骤**:
1. 退出管理员账号,重新登录 `user@sep.local`
2. 打开「小海」会话
3. 输入: `查询北京今天天气` (触发工具调用)

**预期结果**:
- ✅ 流程完整:
  1. 用户消息显示
  2. 工具调用卡片显示
  3. 工具结果卡片显示
  4. **助手最终回复**(基于工具结果的总结,如「北京今天晴转多云,温度 25-32°C」)
- ❌ **不应该**:工具执行后就结束,没有最终回复

**失败处理**:
- 如果没有最终回复,查看后端日志:
  ```bash
  docker logs sep-backend 2>&1 | grep -E "Stream Step|tool_end|finishReason" | tail -30
  ```
- 应看到 `stepCount++` 后再次进入循环,`finishReason !== 'tool-calls'` 时生成最终回复

**⚠️ 注意**: 如果工具本身失败(如 OpenCode 未配置),仍应生成最终回复(如「抱歉,查询失败」)。

---

## 验收标准

### 通过标准

**5 个用例全部通过**,即:
- ✅ 用例 1: 普通对话 10 秒内回复
- ✅ 用例 2: 工具卡片不显示 `undefined`
- ✅ 用例 3: 数据库 TOOL 消息为人类可读文本
- ✅ 用例 4: 账号切换无数据泄漏
- ✅ 用例 5: 工具调用后有最终回复

### 不通过标准

**任意 1 个用例失败**,需:
1. 记录失败截图/日志
2. 报告给开发者
3. 重新修复后再次验收

---

## 补充验证(可选)

### 后端日志检查

```bash
# 查看最近 100 行日志
docker logs sep-backend 2>&1 | tail -100

# 应包含:
# [Stream Init] session=xxx, model=deepseek-v4-flash, tools=1
# [Stream Step] step=0, messages=3
# [Stream Result Created] session=xxx
```

### 数据库完整性检查

```bash
docker exec -i sep-postgres psql -U sep -d sep_platform << 'SQL'
-- 检查消息记录
SELECT 
  role, 
  COUNT(*) as count,
  MAX("createdAt") as latest
FROM messages
GROUP BY role;

-- 检查工具执行记录
SELECT 
  status,
  COUNT(*) as count
FROM tool_executions
GROUP BY status;
SQL
```

**预期结果**:
- `role` 应包含 `USER`, `ASSISTANT`, `TOOL`
- `tool_executions` 应有记录(如果执行过工具调用)

---

## 验收报告模板

```markdown
# E2E 测试修复验收报告

**验收时间**: 2026-07-24 XX:XX  
**验收人**: Codex  
**环境**: macOS, Docker, localhost:3000

## 验收结果

| 用例 | 状态 | 备注 |
|------|------|------|
| P0-1: 普通 AI 回复 | ✅ 通过 / ❌ 失败 | |
| P0-2: undefined.id | ✅ 通过 / ❌ 失败 | |
| P0-4: JSON 泄漏 | ✅ 通过 / ❌ 失败 | |
| P1-1: 缓存泄漏 | ✅ 通过 / ❌ 失败 | |
| P0-3: 最终回复 | ✅ 通过 / ❌ 失败 | |

## 总体结论

- [ ] **通过** - 所有用例通过,修复有效,可发布
- [ ] **不通过** - 存在失败用例,需重新修复

## 失败详情(如有)

[粘贴失败截图/日志]

## 建议

[如有改进建议]
```

---

## 附录

### 修复文件清单

| 文件 | 修改行数 | 说明 |
|------|---------|------|
| `backend/src/modules/conversation/conversation-stream.service.ts` | ~40 行 | P0-1/P0-2/P0-4 修复 |
| `web/src/features/auth/use-auth.ts` | 3 行 | P1-1 修复 |

### 相关文档

1. **00-原始修复记录.md** - 第一次修复的原始记录
2. **01-修复清单.md** - 详细修复方案和诊断过程
3. **02-修复报告.md** - 第一轮修复报告
4. **03-修复总结.md** - 最终修复总结
5. **04-Codex验收文档.md** (本文档) - 验收测试用例

---

**开始验收**: 请按顺序执行用例 1-5,记录结果,填写验收报告。

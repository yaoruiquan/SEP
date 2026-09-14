# SEP 客户端共享联调完整对接文档 v2

> 联调环境：`https://sep-dev.longdaoSEP.cn`

## 1. 两阶段架构

| 阶段 | 目标 | 执行位置 | 云端职责 |
| --- | --- | --- | --- |
| 第一阶段：员工直接使用 | 登录后加载有权限的硅基员工并运行 | Electron 客户端 | 返回订阅锁定版本的运行时清单、技能和授权令牌 |
| 第二阶段：任务云端监控 | 客户端执行工作安排，Web 查看状态 | Electron 执行，云端保存镜像 | 保存状态、进度、心跳、事件和错误摘要 |

客户端是执行端，云端不是任务 worker。云端不接收任务正文、完整 prompt、文件内容、密钥或本地绝对路径。

## 2. 环境与认证

API 根地址：`https://sep-dev.longdaoSEP.cn/api`。

登录：`POST /client/auth/login`，请求字段：`email`、`password`、`fingerprint`、`platform`、`clientVersion`。响应的 `accessToken` 用于普通 API，`refreshToken` 只保存在 Electron 主进程安全存储中。刷新：`POST /client/auth/refresh`，请求 `{ "refreshToken": "..." }`。认证请求统一增加 `Authorization: Bearer <accessToken>`。

## 3. 第一阶段：员工直接使用

### 3.1 订阅和 runtime 接口

- `GET /client/subscriptions`：返回当前成员有直接授权或部门授权的有效订阅。
- `GET /client/subscriptions/:subscriptionId/runtime`：返回订阅锁定版本的员工配置、模型限制、配置和已审核技能正文。
- `POST /client/auth/token`：请求 `{ "refreshToken": "...", "subscriptionId": "sub_xxx" }`，返回该订阅的短期 `employmentToken`。

runtime 响应核心结构：

```json
{
  "manifestVersion": 1,
  "subscriptionId": "sub_xxx",
  "templateVersion": "1.0.0",
  "employee": { "id": "employee_xxx", "name": "研究助理", "maxSteps": 20 },
  "runtime": {
    "systemPrompt": "...",
    "modelId": "gemini-3.5-flash-high",
    "allowedModels": ["gemini-3.5-flash-high"],
    "config": {},
    "skills": [{ "capabilityId": "cap_xxx", "name": "网页检索", "versionId": "sv_xxx", "version": "1.2.0", "content": "# SKILL.md ..." }]
  }
}
```

### 3.2 客户端必须实现

1. 在主进程调用接口，不让 renderer 持有 refresh token。
2. 缓存到 `app.getPath('userData')/runtime/<enterpriseId>/<subscriptionId>/<templateVersion>/`。
3. 将技能 `content` 写成 `skills/<安全名称>/SKILL.md`。
4. 使用内置 Pi runtime 加载 `systemPrompt`、`modelId`、`allowedModels`、技能路径和 `maxSteps`。
5. 清单/订阅版本/技能选择变化时重新准备，临时目录成功后原子替换。
6. 到期或撤销授权时删除 runtime 并停止新任务。
7. employment token 只用于该订阅的模型/能力调用，过期后重新换取。

当前已实现：`electron/auth/auth-api.ts`、`electron/runtime/subscription-runtime.ts`、`electron/main.ts`。请确认 Pi session 使用 `preparedRuntime.skillPaths`、`agentsFiles`、`systemPrompt` 和 employment token，而不是旧全局技能目录。ZIP/packageRef 仅是异常兜底。

## 4. 第二阶段：客户端执行、云端监控

### 4.1 接口调用

1. 创建本地任务后：`POST /client/tasks`。

```json
{"clientTaskId":"local-task-01JABC","clientRunId":"run-01JABC","subscriptionId":"sub_xxx","title":"整理本周客户反馈","taskType":"scheduled","modelId":"gemini-3.5-flash-high","clientVersion":"0.1.0"}
```

保存响应中的云端 `id`，后续使用该 ID；同一用户的 `clientTaskId` 应稳定，重复创建会复用镜像。

2. 状态上报：`PATCH /client/tasks/:id/status`，字段 `status`、`progress`、`currentStep`、`activity`、`errorSummary`。状态值：`QUEUED`、`RUNNING`、`WAITING_APPROVAL`、`PAUSED`、`COMPLETED`、`FAILED`、`CANCELLED`。
3. 心跳：`POST /client/tasks/:id/heartbeat`，字段 `progress`、`currentStep`、`activity`、`clientVersion`。运行中每 15-30 秒一次；超过 60 秒无心跳且未终态，Web 显示“离线/未知”。
4. 事件：`POST /client/tasks/:id/events`。

```json
{"sequence":1,"type":"step.completed","stepKey":"summarize","message":"已生成摘要","progress":80,"occurredAt":"2026-09-14T08:02:00.000Z"}
```

`sequence` 按任务从 1 开始递增，云端按任务和 sequence 去重。详情查询：`GET /client/tasks/:id`；企业列表：`GET /client/tasks`。

## 5. 客户端需要新增的同步模块

任务同步由客户端负责，建议改动：

```text
electron/tasks/task-manager.ts
electron/tasks/task-execution-coordinator.ts
electron/main.ts
```

每个本地任务保存 `cloudMirrorId`、`clientRunId`、`lastSequence`。状态、心跳和事件先写本地持久化队列再异步发送，断网不能阻塞本地执行。网络错误指数退避；退出、休眠、断网时保留队列；恢复后按“创建镜像 -> 状态/事件 -> 心跳”顺序补传。2xx 或重复 sequence 均可删除队列项。401 先刷新 access token；授权失败则停止该任务同步并提示重新授权。主进程负责队列和 token，renderer 只能获取脱敏状态。

## 6. Web 监控位置

企业端侧边栏的“工作安排”页面内有两个 Tab：`我的工作安排` 和 `客户端监控`。监控展示标题、状态、进度、当前活动、客户端版本、心跳状态、错误摘要和事件流水，不展示任务正文。

## 7. 联调验收

阶段一：登录 -> `/client/subscriptions` -> runtime 清单 -> 本地 `SKILL.md` -> employment token -> Pi session 调用模型和技能 -> 撤销授权后旧 runtime 不再使用。

阶段二：创建镜像 -> `QUEUED/RUNNING` -> Web 出现 -> 进度/心跳刷新 -> sequence 事件去重 -> 断网本地继续并恢复补传 -> `COMPLETED/FAILED` 显示终态。

## 8. 安全边界与排错

允许上传：任务标题、类型、订阅 ID、模型 ID、客户端版本、状态、进度、步骤标识、活动/错误摘要、事件序号。禁止上传 prompt、上下文、知识库正文、文件内容、绝对路径、Cookie、任何 token 或 API key。

`/client/subscriptions` 为空通常是无企业授权或无 EmployeeGrant；runtime 403 通常是订阅到期/授权失效；Web 无任务时检查创建镜像是否成功保存云端 ID；事件为空时检查是否使用云端镜像 ID及从 1 开始的 sequence。

当前 SEP 后端、Web 监控、runtime API 和任务镜像 migration 已部署到联调环境。runtime 准备逻辑已存在；任务同步队列和断网补传需客户端开发者按第 5 节接入。

健康检查：`https://sep-dev.longdaoSEP.cn/api/health/ready`，返回所有检查项 `ok` 后再开始联调。

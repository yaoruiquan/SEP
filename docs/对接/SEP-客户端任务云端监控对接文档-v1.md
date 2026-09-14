# SEP 客户端任务云端监控对接文档 v1

## 1. 目标与边界

客户端负责真实执行工作安排，SEP 云端负责保存可观测的任务镜像。Web 企业端在“工作安排 -> 客户端监控”中查看任务状态、进度、当前活动、心跳、版本和脱敏事件。

云端不保存客户端任务正文、完整 prompt、本地绝对路径或技能文件内容。模型调用仍使用 employment token，由 SEP 网关完成权限和用量记录。

## 2. 环境与认证

接口前缀：`{SEP_API_BASE_URL}/api`。

所有接口都需要登录用户的 Bearer Token：

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

客户端使用与 Web 相同的 SEP 账号登录。创建任务时提交的 `subscriptionId` 必须属于当前用户，且订阅状态为 `ACTIVE`、未过期。

## 3. 创建云端任务镜像

```http
POST /client/tasks
```

请求示例：

```json
{
  "clientTaskId": "local-task-01JABC",
  "clientRunId": "run-01JABC",
  "subscriptionId": "sub_xxx",
  "title": "整理本周客户反馈",
  "taskType": "scheduled",
  "modelId": "gpt-4o-mini",
  "clientVersion": "1.4.0"
}
```

响应返回已创建的任务镜像，包含服务端 `id`。后续状态、心跳和事件接口使用这个 `id`。

## 4. 状态与进度

```http
PATCH /client/tasks/:id/status
```

请求示例：

```json
{
  "status": "RUNNING",
  "progress": 35,
  "currentStep": "读取客户反馈文件",
  "activity": "正在调用知识库检索",
  "errorSummary": null,
  "startedAt": "2026-09-14T08:00:00.000Z",
  "completedAt": null
}
```

状态值：`QUEUED`、`RUNNING`、`WAITING_APPROVAL`、`PAUSED`、`COMPLETED`、`FAILED`、`CANCELLED`。

`progress` 使用 0-100 的数字。建议状态变化和明显进度变化时立即同步；不要每个 token 都同步。

## 5. 心跳

```http
POST /client/tasks/:id/heartbeat
```

请求示例：

```json
{
  "progress": 42,
  "currentStep": "生成汇总",
  "activity": "模型处理中",
  "clientVersion": "1.4.0"
}
```

运行中任务建议每 15-30 秒发送一次。Web 端超过 60 秒没有心跳且任务不是终态时显示“离线/未知”，这不代表云端自动将任务标记为失败。客户端恢复联网后继续发送状态即可。

## 6. 事件流水

```http
POST /client/tasks/:id/events
```

请求示例：

```json
{
  "sequence": 12,
  "type": "step.completed",
  "stepKey": "summarize",
  "message": "已生成 3 条结论",
  "progress": 80,
  "occurredAt": "2026-09-14T08:02:00.000Z"
}
```

`sequence` 必须由客户端任务本地单调递增，从 1 开始。云端按任务维度去重：已收到的序号会被忽略，重复提交不会产生重复事件。断网时必须将状态和事件落盘，恢复后按 sequence 从小到大补传。

只上传脱敏摘要、步骤标识、状态和错误摘要。禁止上传完整 prompt、模型上下文、文件内容、密钥、Cookie、本地绝对路径。

## 7. 查询接口（Web/调试使用）

```http
GET /client/tasks
GET /client/tasks/:id
```

列表接口返回当前企业的任务镜像，详情接口额外返回 `events`。客户端一般不需要调用这两个接口，主要用于 Web 监控和联调排查。

任务主要字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 云端任务镜像 ID |
| `clientTaskId` | 客户端本地任务 ID |
| `status` | 当前执行状态 |
| `progress` | 0-100 进度 |
| `currentStep` | 当前步骤摘要 |
| `activity` | 当前活动摘要 |
| `lastHeartbeatAt` | 最近心跳时间 |
| `lastSequence` | 云端已接收的最大事件序号 |
| `errorSummary` | 脱敏错误摘要 |
| `clientVersion` | 客户端版本 |

## 8. 客户端同步器建议

客户端 `TaskManager` 为每个任务维护本地队列：

1. 创建任务镜像成功后保存云端 `id`。
2. 状态、心跳和事件先写本地队列，再异步发送。
3. 发送成功后删除队列项；网络失败则指数退避重试。
4. 事件严格按 `sequence` 顺序发送；收到重复请求也视为成功。
5. 应用退出、系统休眠或断网时不丢弃未发送数据。
6. 任务完成或失败后仍保留最终状态和最后一批事件。

## 9. 联调验收

1. 客户端登录测试账号并选择一个有效订阅。
2. 创建任务镜像，确认返回云端 `id`。
3. 发送 `RUNNING`、进度和心跳，在 Web 的“客户端监控”看到任务。
4. 连续发送两个事件，确认详情中 sequence 为 1、2。
5. 重复发送 sequence=2，确认不会出现第二条重复事件。
6. 停止心跳超过 60 秒，Web 状态显示“离线/未知”。
7. 恢复联网并补传心跳，确认状态恢复为客户端上报状态。
8. 发送 `COMPLETED`，确认 Web 显示“已完成”。

## 10. 与 Web 的位置

入口固定在企业端侧边栏的“工作安排”页面内，页面顶部 Tab 为：

- `我的工作安排`：原有云端规划和执行流程。
- `客户端监控`：客户端执行任务的实时镜像和事件流水。

无需新增侧边栏入口，也无需把客户端任务正文同步到 Web。

# SEP 计费系统端到端测试报告

> 测试日期：2026-07-25  
> 测试依据：[E2E-Test-Guide-Billing.md](../guides/E2E-Test-Guide-Billing.md)  
> 测试方式：真实浏览器操作、后端日志只读检查、PostgreSQL 只读查询  
> 测试地址：前端 `http://localhost:3000`；后端 Swagger `http://localhost:3001/api/docs`  
> 约束：本轮未修改源代码、配置、依赖或数据库结构；仅创建对话测试数据并新增本报告。

## 1. 测试结论

**计费系统端到端测试不通过。**

3 轮普通 AI 对话均能完成并持久化助手消息，但上游 usage 中的 `outputTokens` 始终为 `0`。后端因此连续输出 `[Billing] Skipped recording - missing usage data`，没有创建任何 `CONSUME` 交易记录；用量统计页面的余额、累计消费、输入 Token、输出 Token 均保持 `0`。因此，对话计费、用量累计、交易记录与价格计算这几个核心验收目标均未满足。

## 2. 执行概况

| 场景 | 结果 | 关键证据 |
|---|---|---|
| 环境与前置条件 | **部分通过** | PostgreSQL/Redis/sub2api healthy，前端可访问，Swagger HTTP 200；但 `/health` 返回 404，测试指南账号密码和余额前置条件不匹配 |
| 场景 1：对话生成与计费 | **不通过** | AI 回复完成，但 3 次均 `outputTokens=0`，记账被跳过 |
| 场景 2：用量统计查询 | **不通过** | `/usage` 刷新后四项统计均为 0，显示“暂无交易记录” |
| 场景 3：多轮对话计费累加 | **不通过** | 连续 3 轮对话后无任何消费、Token 累加或新增交易记录 |
| 场景 4：数据库验证 | **不通过** | ASSISTANT 消息已保存 input token，但 output token 均为 0；`compute_transactions` 无 CONSUME 记录 |
| 场景 5：价格计算验证 | **无法完成 / 不通过** | 没有可供核对的交易 metadata；且指南价格表与当前实现价格表不一致 |

## 3. 环境与测试数据

### 3.1 服务检查

| 检查项 | 结果 | 证据 |
|---|---|---|
| PostgreSQL | 通过 | `sep-postgres` 状态为 healthy |
| Redis | 通过 | `sep-redis` 状态为 healthy |
| sub2api | 通过 | `sub2api-dev` 状态为 healthy |
| 后端健康检查 | 不通过 | `GET http://localhost:3001/health` 返回 HTTP 404 |
| 后端 Swagger | 通过 | `GET http://localhost:3001/api/docs` 返回 HTTP 200 |
| 前端 | 通过 | `http://localhost:3000/` 返回 307，正常跳转至登录流程 |

### 3.2 指南与实际演示数据差异

1. 指南指定 `admin@sep.local / Admin@123`。真实浏览器登录返回“邮箱或密码错误”。项目种子数据和既有测试文档显示实际演示密码为 `Demo123456`，使用该密码可登录。
2. 指南要求账户有充足余额（例如 ¥100）。只读查询显示：
   - `admin@sep.local` 余额：¥0.00；
   - `user@sep.local` 初始不存在计费账户，首次访问用量页后自动创建，余额：¥0.00。
3. 管理员登录后默认进入 `/admin`，其管理端导航没有“对话中心”。直接访问 `/chat` 可以进入对话页。因此本轮使用普通用户 `user@sep.local / Demo123456` 完成主计费流程；该用户已订阅“小文”。

上述前置条件不符合指南，但不影响本轮对“AI 已正常回复而计费未落账”的缺陷判定。

## 4. 场景 1：对话生成与计费

### 4.1 操作步骤

1. 使用 `user@sep.local / Demo123456` 登录。
2. 打开“用量统计”，记录基线：余额 ¥0.00、累计消费 ¥0.00、输入/输出 Token 均为 0、无交易记录。
3. 新建会话，选择已订阅员工“小文”。
4. 发送：`你好,请介绍一下你自己`。

### 4.2 页面结果

- 用户消息立即显示。
- 小文生成了完整的中文回复；对话流能够正常完成。
- 页面将同一段助手回复显示了两次，未满足“回复完成后不出现重复内容”的预期。
- 后端存在 `[Stream Init]`、`[Stream Step]`、`[Stream Result Created]` 日志，证明对话流请求已成功建立并完成。

### 4.3 后端日志证据

本次会话 ID：`cmrzqw72h000d7qcwkyn98tiz`。

```text
[Stream Init] session=cmrzqw72h000d7qcwkyn98tiz, model=gemini-3.5-flash-high, tools=1
[Stream Step] step=0, messages=2
[Stream Result Created] session=cmrzqw72h000d7qcwkyn98tiz
[Billing Check] usage={"inputTokens":16,...,"outputTokens":0,...,"totalTokens":16}, input=16, output=0
[Billing] Skipped recording - missing usage data for session cmrzqw72h000d7qcwkyn98tiz
```

结论：流式对话正常，但 `outputTokens` 缺失，导致 `[Billing] Recording usage` 没有出现，**场景不通过**。

## 5. 场景 2：用量统计查询

对话完成后访问并刷新 `/usage`，页面显示：

```text
账户余额：¥0.00
累计消费：¥0.00
输入 Token：0
输出 Token：0
交易记录：💰 暂无交易记录
```

预期中的本次对话消费记录、负数金额、模型名称描述和会话关联均未出现，**场景不通过**。

## 6. 场景 3：多轮对话计费累加

在同一会话继续发送：

1. `你会写代码吗?`
2. `用 Python 写一个 Hello World`

三轮对话均收到了完整回复，但第二、第三轮也在浏览器页面各显示了一份重复的助手内容。

三次后端日志如下：

| 轮次 | 输入 Token | 输出 Token | 计费结果 |
|---|---:|---:|---|
| `你好,请介绍一下你自己` | 16 | 0 | Skipped recording |
| `你会写代码吗?` | 269 | 0 | Skipped recording |
| `用 Python 写一个 Hello World` | 431 | 0 | Skipped recording |

刷新用量统计页面后数值仍全部为 0，未增加任何交易记录或扣减余额，**场景不通过**。

## 7. 场景 4：数据库验证

### 7.1 Message 表

会话 `cmrzqw72h000d7qcwkyn98tiz` 的 ASSISTANT 消息已成功保存，但 Token 字段结果如下：

| 角色 | 条数 | inputTokens 合计 | outputTokens 合计 |
|---|---:|---:|---:|
| USER | 3 | 0 | 0 |
| ASSISTANT | 3 | 716 | 0 |

单条助手消息分别为：`16/0`、`269/0`、`431/0`（输入/输出 Token）。

`messages` 表已有 `inputTokens`、`outputTokens` 两个 nullable 字段，数据库结构可以承载数据；问题在于实际流式结果没有得到大于 0 的输出 Token。

### 7.2 ComputeTransaction 表

```text
会话 cmrzqw72h000d7qcwkyn98tiz 的 CONSUME 记录数：0
user@sep.local 的全部 CONSUME 记录数：0
账户余额：¥0.00
```

因此无法验证负数 `amount`、`metadata.inputTokens`、`metadata.outputTokens`、`costUSD`、`costCNY` 及 `sessionId` 的落库一致性，**场景不通过**。

## 8. 场景 5：价格计算验证

由于没有任何 `CONSUME` 交易和 metadata，本轮无法执行以真实交易为输入的价格公式核验。

此外，指南示例与当前实现的 `gemini-3.5-flash-high` 价格配置不一致：

| 来源 | 输入价格（USD / 1M tokens） | 输出价格（USD / 1M tokens） |
|---|---:|---:|
| 测试指南 | 0.05 | 0.15 |
| 当前 `backend/src/shared/index.ts` | 0.15 | 0.60 |

若按指南示例的 15 输入 / 120 输出 Token 计算：

- 指南公式结果：¥0.000135；
- 当前实现价格表对应结果：¥0.0005346；
- 两者相差约 3.96 倍。

应在计费功能恢复后统一产品价格来源、实现价格表和测试指南，再进行真实交易金额核验。

## 9. 缺陷清单

| 优先级 | 缺陷 | 影响 | 证据 |
|---|---|---|---|
| P0 | 输出 Token 始终为 0，导致计费跳过 | 所有正常 AI 对话都不生成消费记录，平台无法计费 | 3 轮 `[Billing Check]` 均为 `outputTokens:0`，随后 `[Billing] Skipped recording` |
| P1 | 流式助手回复在页面重复显示 | 对话体验错误，违反指南“不出现重复内容”要求 | 第二、第三轮回复在真实页面中各出现两份 |
| P1 | 用量统计始终为 0、无交易记录 | 用户无法查看实际消费、Token 和会话关联 | `/usage` 刷新后四项指标均为 0，数据库无 CONSUME |
| P2 | 计费测试指南与当前演示环境不一致 | 按指南无法直接使用指定凭据/余额完成测试 | `Admin@123` 登录失败、余额为 0、管理员默认导航无对话入口 |
| P2 | 指南价格表与实现价格表不一致 | 即使交易恢复，也会导致金额验收基准错误 | `0.05/0.15` 与 `0.15/0.60` 不一致 |
| P2 | 健康检查地址失效 | 自动化前置检查按指南会误判后端不可用 | `/health` 返回 404，Swagger 返回 200 |

## 10. 修复与复测建议

1. 核对 AI SDK/sub2api 返回的 usage 字段，确保完成事件中同时取得正数 `inputTokens` 与 `outputTokens`；在无法获取 usage 时，明确产品策略（拒绝计费、可靠估算或延迟对账），避免静默漏计费。
2. 修复后至少验证一次成功的 `recordUsage()`：应看到 `[Billing] Recording usage`、`Recorded usage for user ...`，并在数据库形成一条负金额 `CONSUME` 记录。
3. 修复前端流式消息状态合并逻辑，保证已持久化助手消息不会与实时预览重复渲染。
4. 更新指南中的账号密码、余额准备、后端健康检查路径、管理员对话入口说明与模型价格；或把环境/实现调整到文档定义的契约。
5. 修复后按本指南重跑 3 轮对话、`/usage` 刷新、数据库交易 metadata 和金额公式的全链路验收。

## 11. 最终判定

**不通过，暂不建议将当前版本作为可计费 AI 对话能力发布。**

本轮验证了对话生成链路可用，但计费和用量统计链路在所有测试轮次均未执行成功。当前问题属于收入与用量核算核心路径，需修复并完成全量复测后再验收。

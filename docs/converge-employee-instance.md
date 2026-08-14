# 收敛员工实例：EmployeeInstance → Subscription

**分支**：`refactor/converge-employee-instance`
**日期**：2026-08-13

## 一句话

企业订阅某个员工，就是雇佣了这个员工。雇佣关系本身即权限锚点，中间不需要「实例」这第三个对象。

## 为什么要收敛

`EmployeeInstance` 表有 6 样东西，逐个核对后只有一样在真正工作：

| 字段/关系 | 设计意图 | 实际状态 |
|---|---|---|
| `name` | 企业自定义名称 | 自动创建时复制模板名，从未被改过 |
| `departmentId` | 归属部门 | 自动创建时为 null，UI 无必填入口 |
| `status` | 四态流转 | 与 `SubscriptionStatus` 语义重叠，两处各管一份 |
| `templateVersion` | 锁版本 + 提示式升级 | 在用，但归属错了——该锁在雇佣关系上 |
| `config` | 企业侧配置 | 全项目无一处写入 |
| `grants` / `knowledgeGrants` / `accessRequests` | 权限锚点 | **存在的唯一理由** |

### 三个佐证：多实例从未真正成立

**1. 订阅时只建一个。** `subscription.service.ts` 用 `findFirst` 查到已有实例就跳过，一个模板对一个企业永远只有一份。

**2. 对话根本不认实例。** `ConversationSession.employeeId` 指向模板而非实例。运行时要用实例 ID 检索知识库，只能靠猜：

```ts
const instance = await this.prisma.employeeInstance.findFirst({
  where: { templateId: employee.id },   // ← 没带 enterpriseId
  select: { id: true },
});
```

这里缺少 `enterpriseId` 过滤。若 A、B 两家企业订阅同一模板，检索时可能拿到另一家的实例 ID——**这是一个跨租户知识库越权，收敛后自然消失**。

**3. 成本归因那栏一直是空的。** schema 自己写着「保留以备后续 ConversationSession 挂载 instanceId 后回填，暂为 null」。等不到的，因为会话压根不该挂实例。

### 一处已知冲突

购物车走的是另一条路：`order.service.ts` 按 `quantity` 循环建 N 个实例，前端还把它当卖点展示「订阅后创建 N 个独立实例」。**订阅接口与支付下单接口对「一个订阅几个实例」答案不一致**，历史数据里可能存在一对多，迁移时须合并。

## 三条决策

| 议题 | 决策 |
|---|---|
| 购物车「数量」 | **取消**。一个员工只能雇一次，与 `Subscription @@unique([enterpriseId, employeeId])` 天然一致 |
| 部门差异化配置 | **一并做**。让 `KnowledgeGrant.departmentId` 真正生效（现为死路径） |
| `EmployeeInstance` 表 | **物理删除**，一次到位 |

## 映射关系

| 现在 | 收敛后 |
|---|---|
| `EmployeeGrant.instanceId` | `subscriptionId` |
| `KnowledgeGrant.instanceId` | `subscriptionId` |
| `AccessRequest.instanceId` | `subscriptionId` |
| `CostDailyRollup.employeeInstanceId` | `subscriptionId`（终于能填上） |
| `EmployeeInstance.templateVersion` | `Subscription.templateVersion` |
| `search(query, instanceId)` | `search(query, subscriptionId, departmentId)` |
| 模型优先级 `EMPLOYEE_INSTANCE` 层 | `EMPLOYMENT` 层（语义不变） |
| JWT `type: 'client-instance'` | `type: 'client-employment'` |
| `InstanceStatus` 四态 | 并入 `SubscriptionStatus` |

## 会丢的能力与替代方案

多实例名义上支持「财务部和法务部各用一份文档助手，各挂各的知识库」。合并后一企业一模板只有一份雇佣关系，这种差异化没了。

但 `KnowledgeGrant` **本就有 `departmentId` 字段**，只是检索时从没用过——`knowledge-search.service.ts` 只按 `instanceId` 过滤。部门级隔离的数据结构一直躺在那儿是条死路径。收敛时把检索改成同时认 `subscriptionId` 与用户所在 `departmentId`，部门差异化反而比现在更干净，且无需维护多份实例。

## 执行顺序

1. **Schema 改造** — FK 改指向，`Subscription` 增加 `templateVersion`，删 `EmployeeInstance` 与 `InstanceStatus`
2. **数据迁移**（唯一高风险环节）— 合并历史多实例：每个 `(enterpriseId, templateId)` 选最早实例为主，其余授权记录重挂并去重，回填 `templateVersion`，处理孤儿实例，最后 drop 表
3. **后端删除** — `InstanceService` 与 6 个 `/instances` 端点，升级能力迁入 `SubscriptionService`
4. **后端改造** — `GrantService`、知识检索（含部门过滤）、对话流（修跨租户越权）、成本归因回填、模型配置层改名、client/gateway/package/access-request 同步
5. **前端删页** — `/instances` 整页删除，能力并入 `/subscriptions`；权限矩阵改为「员工 × 部门」
6. **购物车** — 取消数量选择器，加入同一员工改为幂等
7. **术语清理** — 约 50 处「实例」文案
8. **测试** — 修复受影响 spec，新增部门隔离测试与跨租户越权回归测试

## 影响面

后端 33 个文件、前端约 50 处引用，其中真正含逻辑的约 12 个文件，其余为文案与类型定义。

## 待清理的遗留

`input-bar.tsx` 有 4 行 `console.log` 调试语句（上一次多员工协作改动遗留，未提交），顺手一并清掉。

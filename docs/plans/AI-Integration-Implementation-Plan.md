# AI 集成实施计划 — 完整开发清单

> 状态：进行中（2026-07-23）
> 目标：完整实现 sub2api + Coze 集成，打通端到端对话功能

## 关键配置信息

### sub2api 配置
- Base URL: `https://longdaoai.cn/v1`
- API Key: 见 `.env`（`SUB2API_API_KEY`，不得提交到 git）
- 默认模型: `deepseek-v4-flash`（通过 `GET /v1/models` 确认可用；备选 `gemini-3.5-flash-high`）
- 实际可用模型 57 个，调研详见 `docs/research/sub2api用量追踪与计费对接调研.md`

### Coze 集成方案
依据 `docs/research/Coze官方API集成调研与方案.md`，采用 **Coze Bot Chat API**：
- 端点: `POST {COZE_API_BASE}/v3/chat`（中国区 `api.coze.cn`，国际区 `api.coze.com`）
- 请求: `{ bot_id, user_id, stream: true, auto_save_history: true, additional_messages: [...] }`
- 响应: SSE 流式，事件类型 `conversation.message.delta` / `conversation.chat.completed`
- 鉴权: `Authorization: Bearer {COZE_PAT}`（Personal Access Token，服务端持有）
- 会话: Coze `conversation_id` 需与 SEP `sessionId` 分开映射，不能直接混用

---

## 阶段 1：数据库 Schema 扩展（30 分钟）

### 1.1 DigitalEmployee 增加 modelId 字段

**文件**: `backend/prisma/schema.prisma`

**修改**:
```prisma
model DigitalEmployee {
  id           String          @id @default(cuid())
  name         String
  description  String?
  avatarUrl    String?
  status       EmployeeStatus
  systemPrompt String?         // 已存在，需在管理端暴露编辑
  modelId      String?         // 新增：指定模型，null=使用系统默认
  
  // ... 其他字段
  @@map("digital_employees")
}
```

**执行**:
```bash
pnpm db:migrate --name add_model_id_to_digital_employee
pnpm db:generate
```

---

## 阶段 2：环境变量与配置（15 分钟）

### 2.1 后端 .env 配置

**文件**: `backend/.env` (本地开发)、`.env.example` (模板)

**新增**:
```env
# sub2api 配置
SUB2API_BASE_URL=https://longdaoai.cn/v1
SUB2API_API_KEY=见 .env（不得提交到 git）
SUB2API_DEFAULT_MODEL=deepseek-v4-flash

# Coze 集成配置
COZE_API_BASE=https://api.coze.cn  # 中国区；国际区用 https://api.coze.com
COZE_PAT=              # Personal Access Token，见 .env（不得提交到 git）
COZE_REQUEST_TIMEOUT=30000  # 30秒超时
```

### 2.2 共享常量

**文件**: `backend/src/shared/constants.ts` (新建)

```typescript
// 模型 ID 均已通过 GET /v1/models 在 sub2api 确认可用
// 完整列表见 docs/research/sub2api用量追踪与计费对接调研.md
export const MODEL_CATALOG = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek' },
  { id: 'gemini-3.5-flash-high', label: 'Gemini 3.5 Flash High', provider: 'google' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
] as const;
```

---

## 阶段 3：核心服务实现（4-6 小时）

### 3.1 ModelService - sub2api 集成

**文件**: `backend/src/modules/conversation/services/model.service.ts` (新建)

**功能**:
- 初始化 Vercel AI SDK 的 openai-compatible provider
- 根据 DigitalEmployee.modelId 选择模型
- 暴露 `streamText()` 方法供 ConversationService 调用

**核心代码**:
```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, CoreMessage, CoreTool } from 'ai';

@Injectable()
export class ModelService {
  private provider: any;
  
  constructor(private configService: ConfigService) {
    this.provider = createOpenAICompatible({
      baseURL: this.configService.get('SUB2API_BASE_URL'),
      apiKey: this.configService.get('SUB2API_API_KEY'),
    });
  }
  
  async streamConversation(params: {
    modelId: string;
    systemPrompt: string;
    messages: CoreMessage[];
    tools: Record<string, CoreTool>;
  }) {
    const model = this.provider(params.modelId);
    return streamText({
      model,
      system: params.systemPrompt,
      messages: params.messages,
      tools: params.tools,
      maxSteps: 5, // 最多 5 轮工具调用
    });
  }
}
```

### 3.2 CapabilityToolBuilder - 工具编排

**文件**: `backend/src/modules/capability/services/tool-builder.service.ts` (新建)

**功能**:
- 将 EmployeeCapabilityBinding[] 转换为 Vercel AI SDK 的 `tools` 对象
- 每个能力的 `inputSchema` → Zod schema → tool definition
- 执行时路由到对应的 Adapter

**核心代码**:
```typescript
@Injectable()
export class CapabilityToolBuilder {
  constructor(
    private cozeAdapter: CozeAgentAdapter,
    private openCodeAdapter: OpenCodeSkillAdapter,
    // ... 其他 adapter
  ) {}
  
  buildTools(bindings: EmployeeCapabilityBinding[]): Record<string, CoreTool> {
    const tools: Record<string, CoreTool> = {};
    
    for (const binding of bindings) {
      const capability = binding.capability;
      const version = capability.versions[0]; // 激活版本
      
      tools[capability.name] = {
        description: capability.description,
        parameters: this.convertSchemaToZod(version.inputSchema),
        execute: async (args) => this.executeCapability(capability, args),
      };
    }
    
    return tools;
  }
  
  private async executeCapability(capability: Capability, args: any) {
    switch (capability.type) {
      case 'AGENT':
        return this.cozeAdapter.execute(capability, args);
      case 'SKILL':
        return this.openCodeAdapter.execute(capability, args);
      // ... 其他类型
      default:
        throw new Error(`Unsupported capability type: ${capability.type}`);
    }
  }
}
```

### 3.3 CozeAgentAdapter - Coze 调用

**文件**: `backend/src/modules/capability/adapters/coze.adapter.ts` (已存在，需完善)

> 依据 `docs/research/Coze官方API集成调研与方案.md`，采用 **Coze Bot Chat API**（`POST /v3/chat`），
> 不再使用旧的 `.coze.site/run` 部署应用形态。

**功能**:
- 从 capability.config 提取 `bot_id`（Coze Bot ID）
- POST `{COZE_API_BASE}/v3/chat`，`stream: true`，PAT 鉴权
- 消费 SSE 事件流：拼接 `conversation.message.delta`，在 `conversation.chat.completed` 结束
- 会话映射：SEP `sessionId` → Coze `conversation_id`（单独存储，不直接混用）
- 错误归一化（剥离 stack_trace，不泄露 PAT）

**核心代码**:
```typescript
@Injectable()
export class CozeAgentAdapter {
  async execute(capability: Capability, args: any): Promise<string> {
    const config = capability.config as { bot_id: string };
    const base = process.env.COZE_API_BASE ?? 'https://api.coze.cn';
    const pat = process.env.COZE_PAT; // 服务端持有，绝不下发客户端 / 不写日志

    try {
      const response = await axios.post(
        `${base}/v3/chat`,
        {
          bot_id: config.bot_id,
          user_id: `sep_user_${args.userId ?? 'anon'}`,
          stream: true,
          auto_save_history: true,
          additional_messages: [
            { role: 'user', content: JSON.stringify(args), content_type: 'text' },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${pat}`,
            'Content-Type': 'application/json',
          },
          responseType: 'stream',
          timeout: 30000,
        },
      );

      // 消费 SSE：event: conversation.message.delta → 累加 data.content
      //           event: conversation.chat.completed → 结束
      return await this.consumeCozeSse(response.data);
    } catch (error) {
      // 错误归一化（不回传上游 stack_trace / PAT）
      if (error.response?.status === 401) {
        throw new UnauthorizedException('COZE_AUTH_FAILED');
      }
      if (error.response?.status >= 500) {
        throw new InternalServerErrorException('COZE_PROVIDER_ERROR');
      }
      throw error;
    }
  }
}
```

### 3.4 ConversationService - 对话主流程

**文件**: `backend/src/modules/conversation/conversation.service.ts` (修改)

**功能**:
- 接收用户消息
- 加载 DigitalEmployee + 绑定的能力列表
- 调用 ModelService.streamConversation()
- 监听 SSE 事件（text_delta, tool_start, tool_end）
- 保存 Message + ToolExecution 记录

**核心代码**:
```typescript
async streamMessage(sessionId: string, content: string) {
  const session = await this.getSessionWithEmployee(sessionId);
  const employee = session.digitalEmployee;
  
  // 1. 构建工具
  const tools = await this.toolBuilder.buildTools(employee.bindings);
  
  // 2. 加载历史消息
  const history = await this.loadHistory(sessionId);
  
  // 3. 选择模型
  const modelId = employee.modelId ?? process.env.SUB2API_DEFAULT_MODEL;
  
  // 4. 流式调用
  const result = await this.modelService.streamConversation({
    modelId,
    systemPrompt: employee.systemPrompt ?? '你是一个数字员工助手',
    messages: [...history, { role: 'user', content }],
    tools,
  });
  
  // 5. 返回 SSE stream（NestJS @Sse()）
  return this.transformToSSE(result.fullStream);
}
```

---

## 阶段 4：SSE 流式传输（2-3 小时）

### 4.1 后端 SSE Controller

**文件**: `backend/src/modules/conversation/conversation.controller.ts` (修改)

**修改**:
```typescript
@Sse('sessions/:id/stream')
async streamMessages(
  @Param('id') sessionId: string,
  @Body() dto: SendMessageDto,
  @Request() req,
) {
  return this.conversationService.streamMessage(sessionId, dto.content);
}
```

### 4.2 前端 SSE 消费

**文件**: `web/src/features/chat/hooks/useStreamMessage.ts` (已存在，需调试)

**确认事件处理**:
- `text_delta` → 拼接到助手消息
- `tool_start` → 显示工具调用动画
- `tool_end` → 显示工具结果
- `error` → 显示错误提示
- `done` → 标记完成

---

## 阶段 5：管理端 UI（3-4 小时）

### 5.1 创建/编辑员工 - 模型选择

**文件**: `web/src/app/(admin)/employees/components/EmployeeForm.tsx` (修改)

**新增字段**:
```typescript
<FormField
  label="系统提示词"
  name="systemPrompt"
  type="textarea"
  placeholder="定义员工的角色和行为规范..."
/>

<FormField
  label="AI 模型"
  name="modelId"
  type="select"
  options={MODEL_CATALOG}
  placeholder="默认使用系统配置的模型"
/>
```

### 5.2 能力导入 - Coze Bot

**文件**: `web/src/app/(admin)/capabilities/components/CozeImportForm.tsx` (新建)

**功能**:
- 输入 Coze Bot ID（形如 `7xxxxxxxxxxxxxx`，在 Coze 平台 Bot 详情页获取）
- Coze PAT 由服务端全局持有（`COZE_PAT`），不在前端输入
- 点击"测试连接" → 调用 `POST /api/capabilities/coze/test`（服务端用 `/v3/chat` 发一条 ping）
- 测试成功 → 点击"导入" → 创建 AGENT 类型能力

**UI 流程**:
```
[选择能力类型]
  ○ Coze 工作流
  ● Coze Bot  ← 新增
  ○ OpenCode 技能

[Bot ID]
7xxxxxxxxxxxxxxx

（PAT 由服务端全局配置，无需前端输入）

[测试连接] [导入]
```

---

## 阶段 6：后端能力导入服务（2-3 小时）

### 6.1 Coze 测试连接

**文件**: `backend/src/modules/capability/capability.controller.ts` (修改)

**新增端点**:
```typescript
@Post('coze/test')
async testCozeBot(@Body() dto: TestCozeBotDto) {
  return this.capabilityService.testCozeBot(dto.botId);
}
```

**服务实现**（用 `/v3/chat` 发一条非流式 ping，PAT 从服务端配置读取）:
```typescript
async testCozeBot(botId: string) {
  const base = process.env.COZE_API_BASE ?? 'https://api.coze.cn';
  const pat = process.env.COZE_PAT;

  try {
    const response = await axios.post(
      `${base}/v3/chat`,
      {
        bot_id: botId,
        user_id: 'sep-conn-test',
        stream: false,
        auto_save_history: true,
        additional_messages: [
          { role: 'user', content: 'ping', content_type: 'text' },
        ],
      },
      {
        headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );

    // code === 0 表示 Coze 侧受理成功
    return {
      success: response.data?.code === 0,
      message: response.data?.code === 0 ? '连接成功' : (response.data?.msg || '连接失败'),
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.msg || '连接失败',
    };
  }
}
```

### 6.2 Coze 导入能力

**文件**: `backend/src/modules/capability/capability.service.ts` (修改)

**新增方法**:
```typescript
async importCozeBot(dto: ImportCozeBotDto) {
  // 1. 测试连接
  const testResult = await this.testCozeBot(dto.botId);
  if (!testResult.success) {
    throw new BadRequestException('Coze 连接失败');
  }

  // 2. 创建能力（config 存 bot_id；PAT 不入库，运行时从 COZE_PAT 读取）
  const capability = await this.prisma.capability.create({
    data: {
      name: dto.name,
      description: dto.description,
      type: 'AGENT',
      status: 'ACTIVE',
      config: { bot_id: dto.botId },
      versions: {
        create: {
          version: '1.0.0',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: { final_response: { type: 'string' } } },
          status: 'ACTIVE',
        },
      },
    },
  });

  return capability;
}
```

---

## 阶段 7：端到端测试（2-3 小时）

### 7.1 测试流程

1. **启动服务**:
   ```bash
   docker-compose up -d
   pnpm dev:backend
   pnpm dev:web
   ```

2. **管理端操作**:
   - 登录管理端（admin@example.com / Admin123456）
   - 导入一个 Coze Bot（填写 bot_id）
   - 创建一个碳基员工，绑定该能力，选择模型 `deepseek-v4-flash`
   - 设置系统提示词："你是一个智能助手，可以调用工具完成任务"

3. **用户端测试**:
   - 登录用户端（user@example.com / Demo123456）
   - 订阅该员工
   - 创建会话
   - 发送消息："帮我查询天气"
   - 观察 SSE 流式输出：
     - text_delta 事件逐字显示
     - tool_start 显示"正在调用工具..."
     - tool_end 显示工具结果
     - done 标记完成

4. **验证数据库**:
   ```sql
   SELECT * FROM messages WHERE session_id = 'xxx';
   SELECT * FROM tool_executions WHERE message_id = 'xxx';
   ```

### 7.2 E2E 自动化测试

**文件**: `backend/test/conversation.e2e-spec.ts` (新建)

**测试用例**:
- 创建会话 → 发送消息 → 验证 SSE 事件
- 工具调用 → 验证 ToolExecution 落库
- Coze 超时 → 验证错误处理
- 模型选择 → 验证 modelId 生效

---

## 阶段 8：错误处理与优化（2-3 小时）

### 8.1 错误归一化

**Coze 错误映射**:
```typescript
export enum CozeErrorCode {
  AUTH_FAILED = 'COZE_AUTH_FAILED',
  TIMEOUT = 'COZE_TIMEOUT',
  PROVIDER_ERROR = 'COZE_PROVIDER_ERROR',
}
```

**前端错误展示**:
```typescript
if (event.type === 'error') {
  const errorMessage = {
    COZE_AUTH_FAILED: 'Coze 认证失败，请检查 API Token',
    COZE_TIMEOUT: '工具调用超时（>30s），请稍后重试',
    COZE_PROVIDER_ERROR: 'Coze 服务异常',
  }[event.code] || '未知错误';
  
  toast.error(errorMessage);
}
```

### 8.2 性能优化

- 前端消息虚拟滚动（react-window）
- 后端 Redis 缓存历史消息（减少 DB 查询）
- SSE 连接复用（同一会话内）

---

## 进度追踪

- [ ] 阶段 1：数据库 Schema 扩展（30min）
  - [ ] 添加 DigitalEmployee.modelId 字段
  - [ ] 执行迁移

- [ ] 阶段 2：环境变量与配置（15min）
  - [ ] 配置 sub2api 凭据
  - [ ] 添加模型目录常量

- [ ] 阶段 3：核心服务实现（4-6h）
  - [ ] ModelService - sub2api 集成
  - [ ] CapabilityToolBuilder - 工具编排
  - [ ] CozeAgentAdapter - Coze 调用
  - [ ] ConversationService - 对话主流程

- [ ] 阶段 4：SSE 流式传输（2-3h）
  - [ ] 后端 SSE Controller
  - [ ] 前端 SSE 消费调试

- [ ] 阶段 5：管理端 UI（3-4h）
  - [ ] 员工表单 - 模型选择 + 系统提示词
  - [ ] 能力导入 - Coze Bot 表单（填写 bot_id）

- [ ] 阶段 6：后端能力导入服务（2-3h）
  - [ ] Coze 测试连接 API
  - [ ] Coze 导入能力 API

- [ ] 阶段 7：端到端测试（2-3h）
  - [ ] 手动测试全流程
  - [ ] E2E 自动化测试

- [ ] 阶段 8：错误处理与优化（2-3h）
  - [ ] 错误归一化
  - [ ] 性能优化

**总计**: 约 18-24 小时

---

## 待讨论问题（已定稿）

1. **Coze API Token 格式** — ✅ 已定
   - 采用 `pat_xxx`（Personal Access Token），服务端全局持有（`COZE_PAT`），不逐能力配置。
   - 详见 `docs/research/Coze官方API集成调研与方案.md`。

2. **OpenCode Skills Service 优先级** — ✅ 已定
   - 先做 Coze，OpenCode 待 Coze 稳定后再接。
   - 端点/认证：`POST /v1/runs`、`GET /v1/runs/{id}`，`OPENCODE_API_TOKEN` 鉴权（见 CLAUDE.md 外部服务约定）。

3. **RPA 和 AI_APP 类型** — ⏸ 暂不做
   - 本期只交付 `agent`（Coze）+ `skill`（OpenCode）两种执行形态，RPA / AI_APP 延后。

4. **系统提示词管理** — ✅ 已定（最小实现）
   - 管理端只做**单个输入框**填 systemPrompt，不做模板库、不做版本管理。

5. **模型费用追踪** — ⏸ 暂不做（已完成调研）
   - sub2api 返回标准 `usage`，但流式需 `createOpenAICompatible({ includeUsage: true })` 才有值——
     当前代码缺这一项，属已知 bug（见下方修复项）。
   - 计费需自维护「模型→单价」价格表，**本期不做**，仅记录 token 消耗留待后续。
   - 调研详见 `docs/research/sub2api用量追踪与计费对接调研.md`。

---

## 已知 bug / 待修复

- **`includeUsage` 缺失**：`backend/src/modules/conversation/conversation-stream.service.ts`
  创建 provider 时未传 `includeUsage: true`，导致流式 `result.usage` 全空。
- **环境变量名不一致**：`.env` / `.env.example` 曾用 `DEFAULT_MODEL_ID`，而全部后端代码读
  `SUB2API_DEFAULT_MODEL` —— 该变量此前从未生效，已在本轮统一为 `SUB2API_DEFAULT_MODEL`。
- **虚构模型 ID**：`deepseek-chat` 在 sub2api 不存在（`model_not_found`），统一改用
  `deepseek-v4-flash`。

---

## 延后事项（记录，本期不做）

- 计费系统：「模型→单价」价格表 + `ComputeAccount` / `ComputeTransaction` 落地。
- RPA / AI_APP 能力类型的执行适配器。
- 系统提示词模板库与版本管理。

> 状态跟踪见 `docs/status/development-status.md`。

---

## 下一步行动

**立即开始**：
1. 执行阶段 1 数据库迁移
2. 配置阶段 2 环境变量（`SUB2API_*`、`COZE_*`）
3. 修复上述已知 bug（`includeUsage`）
4. 开始实现阶段 3 核心服务

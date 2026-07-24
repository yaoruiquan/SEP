# AI 集成实施计划 — 完整开发清单

> 状态：进行中（2026-07-23）
> 目标：完整实现 sub2api + Coze 集成，打通端到端对话功能

## 关键配置信息

### sub2api 配置
- Base URL: `https://longdaoai.cn/v1`
- API Key: `sk-fcaadc6bd755ca01c416f0a16bf13dc4611fc670e1bc9854b5e2d0fa9762d140`
- 默认模型: `deepseek-chat`

### Coze 集成方案
参考旧项目 ADR-0010，采用 **Coze 部署应用**形态：
- 端点: `POST https://<子域>.coze.site/run`
- 请求: `{ user_message: string, conversation_id?: string }`
- 响应: `{ final_response: string, ...其他动态字段 }`
- 特点: **同步返回**，10-15秒延迟，**无状态单轮**
- 鉴权: `Authorization: Bearer <JWT>` (Coze workload token)

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
SUB2API_API_KEY=sk-fcaadc6bd755ca01c416f0a16bf13dc4611fc670e1bc9854b5e2d0fa9762d140
DEFAULT_MODEL_ID=deepseek-chat

# Coze 集成配置
COZE_API_TOKEN=        # 待提供（格式: pat_xxx 或 JWT）
COZE_REQUEST_TIMEOUT=30000  # 30秒超时（Coze 通常 10-15s）
```

### 2.2 共享常量

**文件**: `backend/src/shared/constants.ts` (新建)

```typescript
export const MODEL_CATALOG = [
  { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek' },
  { id: 'deepseek-reasoner', label: 'DeepSeek R1（深度推理）', provider: 'deepseek' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', provider: 'anthropic' },
] as const;

export const COZE_APP_RUN_HOST_SUFFIX = '.coze.site';
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

**功能**:
- 根据 capability.config 提取 `run_url`
- POST 调用 Coze 部署应用
- 错误归一化（剥离 stack_trace）
- 轮询或同步返回 `final_response`

**核心代码**:
```typescript
@Injectable()
export class CozeAgentAdapter {
  async execute(capability: Capability, args: any): Promise<string> {
    const config = capability.config as { run_url: string };
    const token = process.env.COZE_API_TOKEN;
    
    try {
      const response = await axios.post(
        config.run_url,
        {
          user_message: JSON.stringify(args),
          conversation_id: `sep-${Date.now()}`, // 可选
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );
      
      return response.data.final_response || '执行成功';
    } catch (error) {
      // 错误归一化
      if (error.response?.status === 401) {
        throw new UnauthorizedException('COZE_AUTH_FAILED');
      }
      if (error.response?.status >= 500) {
        // 剥离 stack_trace
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
  const modelId = employee.modelId ?? process.env.DEFAULT_MODEL_ID;
  
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

### 5.2 能力导入 - Coze 部署应用

**文件**: `web/src/app/(admin)/capabilities/components/CozeImportForm.tsx` (新建)

**功能**:
- 输入 Coze 部署应用的 run_url（如 `https://xxx.coze.site/run`）
- 输入 Coze API Token（可选全局配置）
- 点击"测试连接" → 调用 `POST /api/capabilities/coze/test`
- 测试成功 → 点击"导入" → 创建 AGENT 类型能力

**UI 流程**:
```
[选择能力类型]
  ○ Coze 工作流
  ● Coze 部署应用  ← 新增
  ○ OpenCode 技能
  
[部署应用 URL]
https://your-app.coze.site/run

[API Token]（可选，优先使用全局配置）
pat_xxx...

[测试连接] [导入]
```

---

## 阶段 6：后端能力导入服务（2-3 小时）

### 6.1 Coze 测试连接

**文件**: `backend/src/modules/capability/capability.controller.ts` (修改)

**新增端点**:
```typescript
@Post('coze/test')
async testCozeApp(@Body() dto: TestCozeAppDto) {
  return this.capabilityService.testCozeApp(dto.runUrl, dto.token);
}
```

**服务实现**:
```typescript
async testCozeApp(runUrl: string, token?: string) {
  const finalToken = token ?? process.env.COZE_API_TOKEN;
  
  try {
    const response = await axios.post(
      runUrl,
      { user_message: 'ping', conversation_id: 'test' },
      {
        headers: { 'Authorization': `Bearer ${finalToken}` },
        timeout: 30000,
      }
    );
    
    return {
      success: true,
      message: '连接成功',
      response: response.data.final_response,
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
async importCozeApp(dto: ImportCozeAppDto) {
  // 1. 测试连接
  const testResult = await this.testCozeApp(dto.runUrl, dto.token);
  if (!testResult.success) {
    throw new BadRequestException('Coze 连接失败');
  }
  
  // 2. 创建能力
  const capability = await this.prisma.capability.create({
    data: {
      name: dto.name,
      description: dto.description,
      type: 'AGENT',
      status: 'ACTIVE',
      config: { run_url: dto.runUrl },
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
   - 导入一个 Coze 部署应用
   - 创建一个碳基员工，绑定该能力，选择模型 `deepseek-chat`
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
  - [ ] 能力导入 - Coze 部署应用表单

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

## 待讨论问题

1. **Coze API Token 格式**
   - 你们的 token 是 `pat_xxx`（Personal Access Token）还是 JWT workload token？
   - 是全局配置一个 token，还是每个能力独立配置？

2. **OpenCode Skills Service 优先级**
   - 当前计划先做 Coze，OpenCode 是否等 Coze 稳定后再做？
   - OpenCode 的 API 端点和认证方式是什么？

3. **RPA 和 AI_APP 类型**
   - 这两种类型的执行逻辑是什么？
   - 是否有现成的服务可以调用？

4. **系统提示词管理**
   - 是否需要提示词模板库（预设几个常用模板）？
   - 是否支持提示词版本管理？

5. **模型费用追踪**
   - 是否需要记录每次对话的 token 消耗？
   - sub2api 是否返回 usage 信息？

---

## 下一步行动

**立即开始**：
1. 确认 Coze API Token（提供或告知格式）
2. 执行阶段 1 数据库迁移
3. 配置阶段 2 环境变量
4. 开始实现阶段 3 核心服务

**需要你提供的信息**:
- Coze API Token（或告知从哪里获取）
- 确认上述 5 个待讨论问题

一旦这些确认，我立即开始写代码。

# 技能预览功能设计方案

## 功能需求

**核心诉求**：用户在订阅员工前，能够预览该员工包含的技能完整内容（即 agency-agents 的原始 .md 文件），便于理解能力范围和定制化调整。

---

## 使用场景

### 场景 1：运营端 - 技能管理与导入
**角色**：平台运营人员（Admin）

**需求**：
1. 批量导入 agency-agents 技能前，**预览技能内容质量**
2. 检查技能模板的完整性（frontmatter + 正文）
3. 可选：本地化调整（翻译、业务定制）后再导入
4. 查看已导入技能的完整提示词

**操作路径**：
```
运营后台 → 技能库管理 → 选择技能 → 预览按钮 → 弹窗显示完整 markdown
```

---

### 场景 2：企业端 - 已订阅员工的技能查看
**角色**：企业成员（使用中）

**需求**：
1. 在聊天过程中，想知道该员工有哪些技能
2. 查看某个技能的详细提示词，理解该员工的回答逻辑
3. 可选（高级功能）：Fork 技能并自定义，创建企业私有版本

**操作路径**：
```
聊天界面 → 员工信息面板 → 技能列表 → 预览技能
```

---

## 技术实现方案

### 方案 1：直接返回 SkillConfig.template 字段（推荐）

**优点**：
- ✅ **最简单**：API 直接返回数据库中的 `template` 字段
- ✅ **无额外存储**：markdown 内容已存入 `skill_configs.template`
- ✅ **已有接口**：`GET /api/capabilities/:id` 可复用

**实现**：
```typescript
// backend/src/modules/capability/capability.service.ts

async findOne(id: string) {
  const capability = await this.prisma.capability.findUnique({
    where: { id },
    include: {
      agentConfig: true,
      rpaConfig: true,
      skillConfig: true,  // ← 已包含 template 字段
      aiAppConfig: true,
      contributor: { select: { id: true, username: true, email: true } },
      bindings: {
        include: { employee: { select: { id: true, name: true } } }
      }
    }
  });

  // 对于 SKILL 类型，skillConfig.template 就是完整的 markdown 内容
  return capability;
}
```

**前端展示**：
```typescript
// web/src/features/capability/CapabilityPreviewModal.tsx

interface CapabilityPreviewModalProps {
  capability: Capability;
  open: boolean;
  onClose: () => void;
}

export function CapabilityPreviewModal({ capability, open, onClose }: Props) {
  if (capability.type !== 'SKILL') {
    return <div>Only SKILL type capabilities support preview</div>;
  }

  const markdownContent = capability.skillConfig?.template || '';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{capability.name}</DialogTitle>
          <DialogDescription>{capability.description}</DialogDescription>
        </DialogHeader>

        {/* Markdown 渲染 */}
        <ReactMarkdown
          className="prose dark:prose-invert"
          remarkPlugins={[remarkGfm]}
        >
          {markdownContent}
        </ReactMarkdown>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

### 方案 2：新增独立预览接口（适用于复杂场景）

如果需要**权限控制**（如：只有已订阅的企业才能查看完整内容），可以新增接口：

```typescript
// backend/src/modules/capability/capability.controller.ts

@Get(':id/preview')
@UseGuards(JwtAuthGuard)  // 需要登录
@ApiBearerAuth()
@ApiOperation({ summary: 'Preview SKILL capability template' })
@ApiResponse({ status: 200, description: 'Template content' })
async preview(
  @Param('id') id: string,
  @Request() req: { user: { id: string } }
) {
  return this.capabilityService.preview(id, req.user.id);
}
```

```typescript
// backend/src/modules/capability/capability.service.ts

async preview(capabilityId: string, userId: string) {
  const capability = await this.prisma.capability.findUnique({
    where: { id: capabilityId },
    include: { skillConfig: true }
  });

  if (!capability) {
    throw new NotFoundException('Capability not found');
  }

  if (capability.type !== 'SKILL') {
    throw new BadRequestException('Only SKILL type supports preview');
  }

  // 可选：权限检查（是否已订阅该员工）
  // const hasAccess = await this.checkUserAccess(userId, capabilityId);
  // if (!hasAccess) throw new ForbiddenException('Not subscribed');

  return {
    id: capability.id,
    name: capability.name,
    description: capability.description,
    template: capability.skillConfig.template,
    metadata: {
      modelId: capability.skillConfig.modelId,
      temperature: capability.skillConfig.temperature,
      maxTokens: capability.skillConfig.maxTokens,
    }
  };
}
```

---

## 数据流

### 导入时（种子数据/批量上传）
```
agency-agents/*.md
  ↓ 读取文件
  ↓ 解析 frontmatter (name, description, emoji, vibe)
  ↓ 提取完整内容（含 frontmatter + 正文）
  ↓
┌──────────────────────────────────────┐
│ Capability 表                        │
│ - name: frontmatter.name             │
│ - description: frontmatter.description│
│ - type: SKILL                         │
│ - metadata: { emoji, vibe, color }    │
└──────────────────────────────────────┘
           ↓ 1:1 关联
┌──────────────────────────────────────┐
│ SkillConfig 表                       │
│ - template: 完整的 markdown 内容     │  ← 这就是预览的数据源
│ - modelId: gpt-4o-mini               │
│ - temperature: 0.7                   │
└──────────────────────────────────────┘
```

### 查询时
```
前端请求：GET /api/capabilities/:id
  ↓
后端查询：findUnique({ include: { skillConfig: true } })
  ↓
返回：{ ...capability, skillConfig: { template: "# Marketing..." } }
  ↓
前端渲染：<ReactMarkdown>{template}</ReactMarkdown>
```

---

## 前端组件设计

### 1. 聊天界面 - 员工信息面板中的技能预览

```tsx
// web/src/features/chat/EmployeeInfoPanel.tsx

function EmployeeSkillsSection({ employee }: { employee: DigitalEmployee }) {
  const [previewCapability, setPreviewCapability] = useState<Capability | null>(null);

  return (
    <>
      <div className="space-y-2">
        <h3 className="font-semibold">技能列表</h3>
        {employee.bindings.map((binding) => (
          <div key={binding.id} className="flex items-center justify-between p-2 rounded hover:bg-accent">
            <div className="flex items-center gap-2">
              <span className="text-xl">{binding.capability.metadata?.emoji}</span>
              <div>
                <div className="text-sm font-medium">{binding.capability.name}</div>
                <div className="text-xs text-muted-foreground">{binding.capability.description}</div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPreviewCapability(binding.capability)}
            >
              查看
            </Button>
          </div>
        ))}
      </div>

      {previewCapability && (
        <CapabilityPreviewModal
          capability={previewCapability}
          open={!!previewCapability}
          onClose={() => setPreviewCapability(null)}
        />
      )}
    </>
  );
}
```

### 2. 技能预览弹窗

```tsx
// web/src/features/capability/CapabilityPreviewModal.tsx

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

export function CapabilityPreviewModal({ capability, open, onClose }: Props) {
  if (capability.type !== 'SKILL') {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{capability.name}</DialogTitle>
          </DialogHeader>
          <div className="text-muted-foreground">
            此技能类型（{capability.type}）暂不支持预览
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const template = capability.skillConfig?.template || '';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{capability.metadata?.emoji}</span>
            {capability.name}
          </DialogTitle>
          <DialogDescription>{capability.description}</DialogDescription>
        </DialogHeader>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-1">
          <ReactMarkdown
            className="prose dark:prose-invert max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-code:text-sm prose-pre:bg-gray-900"
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                return !inline && match ? (
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              }
            }}
          >
            {template}
          </ReactMarkdown>
        </div>

        <DialogFooter>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-auto">
            <Badge variant="outline">{capability.skillConfig?.modelId}</Badge>
            <span>温度: {capability.skillConfig?.temperature}</span>
            <span>最大 Token: {capability.skillConfig?.maxTokens}</span>
          </div>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 权限控制

### 实施策略
- **已订阅员工的聊天界面** → 允许预览该员工的所有技能
- **运营端技能管理** → 管理员可预览所有技能
- **不支持的场景**：未订阅用户在人才市场预览技能（已移除）

---

## 实施步骤

### 第一步：后端接口（已完成 90%）
- ✅ `GET /api/capabilities/:id` 已返回 `skillConfig.template`
- ⏳ 可选：新增 `GET /api/capabilities/:id/preview` 独立接口
- ⏳ 可选：权限检查逻辑

### 第二步：前端组件（需新增）
1. 安装依赖：
   ```bash
   pnpm add react-markdown remark-gfm react-syntax-highlighter
   pnpm add -D @types/react-syntax-highlighter
   ```

2. 创建组件：
   - `web/src/features/capability/CapabilityPreviewModal.tsx`
   - `web/src/features/employee/EmployeeSkillsSection.tsx`

3. 集成到页面：
   - 人才市场 - 员工详情页
   - 企业端 - 已订阅员工详情页
   - 运营端 - 技能管理页面

### 第三步：样式优化
- Markdown 主题适配暗色模式
- 代码高亮主题选择
- 滚动条样式美化
- 移动端响应式适配

---

## 高级功能（Phase 2）

### 1. 技能对比功能
- 同时预览多个技能，横向对比差异
- 适用场景：选择相似员工时的技能对比

### 2. 技能 Fork 与自定义
- 企业可 Fork 平台技能，创建私有版本
- 修改提示词、调整参数、添加企业特定规则
- 私有技能仅在企业内可见

### 3. 技能评分与反馈
- 用户对技能质量评分（1-5 星）
- 提交改进建议（如：提示词不够清晰）
- 贡献者根据反馈迭代技能

### 4. 技能市场
- 独立的技能市场（类似 Chrome 扩展商店）
- 用户可单独购买技能，自行组装员工
- 贡献者可销售自己的技能模板

---

## 总结

### 推荐方案
- **后端**：复用 `GET /api/capabilities/:id`，无需新接口
- **前端**：新增 `CapabilityPreviewModal` 组件，使用 `react-markdown` 渲染
- **权限**：仅在已订阅员工的聊天界面中提供技能预览
- **Markdown 渲染**：完整渲染 markdown 格式，包括代码高亮、表格、列表等

### 开发优先级
1. ✅ **P0**：聊天界面技能预览弹窗（基础 markdown 渲染）
2. ⏳ **P1**：代码高亮 + 样式优化
3. ⏳ **P2**：移动端适配
4. ⏳ **P3**：运营端技能管理预览
5. ⏳ **P4**：高级功能（Fork、对比、评分）

### 依赖包
```json
{
  "react-markdown": "^9.0.0",
  "remark-gfm": "^4.0.0",
  "react-syntax-highlighter": "^15.5.0",
  "@types/react-syntax-highlighter": "^15.5.0"
}
```

---

## 下一步

你希望我：
1. ✅ **先导入 50 个员工数据**（预览功能后续实现）？
2. 🔧 **先实现预览功能**（前后端完整）？
3. 📝 **继续细化某个技术方案**（如：权限控制、Fork 功能）？

# 会话窗口优化开发计划

> **目标**：提升硅基人才平台会话窗口的用户体验，包含视觉优化、交互增强、功能扩展和性能优化四个维度。
>
> **预计工期**：2-3 周（分 3 个 Phase 迭代）
>
> **优先级**：P0（核心体验）→ P1（重要增强）→ P2（锦上添花）

---

## Phase 1：视觉与基础交互（P0，3-4 天）

### 1.1 Markdown 渲染优化

**现状**：助手回复的富文本内容以纯文本显示，列表、标题、代码块无样式。

**目标**：渲染完整 Markdown，支持标题、列表、代码高亮、引用块、表格。

**技术方案**：
- 已有 `react-markdown` 依赖，扩展配置支持 `remark-gfm`（GitHub Flavored Markdown）
- 代码高亮：`highlight.js` 或 `prism-react-renderer`
- 自定义组件：
  - `<code>` → 行内代码样式
  - `<pre><code>` → 代码块样式 + 语言标签 + 复制按钮
  - `<blockquote>` → 左侧竖线 + 浅灰背景
  - `<table>` → 响应式表格样式

**文件变更**：
- `web/src/features/chat/markdown.tsx` — 扩展 Markdown 组件配置
- `web/src/features/chat/message-bubble.tsx` — 集成 Markdown 渲染器
- `web/src/styles/markdown.css` — Markdown 主题样式（代码高亮、引用块）

**验收标准**：
- [ ] 列表正确渲染（有序/无序/嵌套）
- [ ] 代码块显示语言标签和行号
- [ ] 行内代码有浅灰背景
- [ ] 引用块左侧有主题色竖线
- [ ] 表格响应式适配

---

### 1.2 消息气泡视觉增强

**现状**：用户/助手消息气泡层次感不足，缺少视觉区分。

**目标**：
- 用户消息：右对齐，主题色背景，白色文字，圆角气泡
- 助手消息：左对齐，浅灰背景，带员工头像，左上角半径小于右上角（对话气泡效果）

**样式调整**：
```css
/* 用户消息 */
.message-user {
  margin-left: auto;
  max-width: 70%;
  background: hsl(var(--primary));
  color: white;
  border-radius: 18px 18px 4px 18px; /* 右下角尖角 */
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

/* 助手消息 */
.message-assistant {
  margin-right: auto;
  max-width: 75%;
  background: hsl(var(--muted));
  border-radius: 4px 18px 18px 18px; /* 左上角尖角 */
}
```

**文件变更**：
- `web/src/features/chat/message-bubble.tsx` — 调整气泡样式和布局

**验收标准**：
- [ ] 用户消息有主题色背景和尖角效果
- [ ] 助手消息有员工头像（左侧圆形）
- [ ] 气泡阴影轻微，不过度立体

---

### 1.3 时间戳显示

**现状**：消息没有时间信息，无法追溯对话时序。

**目标**：
- 每条消息下方显示相对时间（"刚刚"、"3 分钟前"、"昨天 14:32"）
- 鼠标悬停显示完整时间戳（"2026-08-19 14:32:15"）

**技术方案**：
- 使用 `date-fns` 的 `formatDistanceToNow` 生成相对时间
- 使用 `format` 生成完整时间
- 添加 `<time>` 元素，`title` 属性存完整时间

**文件变更**：
- `web/src/features/chat/message-bubble.tsx` — 添加时间戳显示
- `web/src/lib/utils.ts` — 添加 `formatMessageTime` 工具函数

**实现示例**：
```tsx
import { formatDistanceToNow, format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

function formatMessageTime(timestamp: string) {
  const date = new Date(timestamp);
  const relative = formatDistanceToNow(date, { addSuffix: true, locale: zhCN });
  const absolute = format(date, 'yyyy-MM-dd HH:mm:ss');
  return { relative, absolute };
}

// 在 MessageBubble 中
<time 
  className="text-xs text-fg-subtle" 
  title={absolute}
  dateTime={timestamp}
>
  {relative}
</time>
```

**验收标准**：
- [ ] 每条消息显示相对时间
- [ ] 悬停显示完整时间戳
- [ ] 超过 24 小时显示 "昨天 HH:mm" 格式
- [ ] 超过 7 天显示 "MM-DD HH:mm" 格式

---

### 1.4 流式输出视觉反馈

**现状**：流式回复时没有明显的"正在输出"视觉提示。

**目标**：
- 助手输出时，文本末尾显示闪烁光标（`▊`）
- 工具调用时显示状态卡片（"正在调用 XX 硅基能力..."）
- Thinking 过程可折叠展示（类似 Claude.ai）

**技术方案**：
1. **闪烁光标**：CSS 动画 `@keyframes blink`
2. **工具调用卡片**：根据 `state.toolCalls` 渲染工具执行状态
3. **Thinking 展示**：`<details>` 元素包裹 `state.reasoning`

**文件变更**：
- `web/src/features/chat/message-bubble.tsx` — 添加流式状态组件
- `web/src/features/chat/tool-call-block.tsx` — 工具调用状态卡片
- `web/src/features/chat/thinking-block.tsx` — 新建 Thinking 折叠块组件

**实现示例**：
```tsx
// 流式光标
{streaming && (
  <span className="animate-blink ml-0.5 text-primary">▊</span>
)}

// 工具调用状态
{toolCalls.map(tc => (
  <div key={tc.id} className="rounded-lg bg-blue-50 p-3 text-sm">
    <div className="flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
      <span>正在调用能力：{tc.name}</span>
    </div>
    {tc.result && <pre className="mt-2 text-xs">{tc.result}</pre>}
  </div>
))}

// Thinking 折叠块
{reasoning && (
  <details className="mb-2 rounded border border-border bg-muted/50 p-3">
    <summary className="cursor-pointer text-xs font-medium text-fg-muted">
      思考过程 💭
    </summary>
    <div className="mt-2 text-xs text-fg-subtle whitespace-pre-wrap">
      {reasoning}
    </div>
  </details>
)}
```

**CSS 动画**：
```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.animate-blink {
  animation: blink 1s ease-in-out infinite;
}
```

**验收标准**：
- [ ] 流式输出时光标闪烁
- [ ] 工具调用显示加载动画和能力名称
- [ ] Thinking 默认折叠，点击展开
- [ ] 工具执行完毕后显示结果（如果有）

---

## Phase 2：交互增强与功能扩展（P1，5-7 天）

### 2.1 消息操作菜单

**现状**：无法复制消息、重新生成回复、或给消息反馈。

**目标**：鼠标悬停消息时，右上角显示操作按钮。

**功能列表**：
- 📋 **复制**：复制消息文本到剪贴板
- 🔄 **重新生成**（仅助手消息）：重新发送上一条用户消息
- 👍👎 **反馈**：点赞/踩，用于模型训练（可选）

**技术方案**：
- 鼠标悬停时显示操作栏（`group-hover` 或 `onMouseEnter`）
- 复制使用 `navigator.clipboard.writeText()`
- 重新生成调用 `handleSend` 并传入上一条用户消息
- 反馈调用 `POST /messages/:id/feedback`

**文件变更**：
- `web/src/features/chat/message-bubble.tsx` — 添加操作栏
- `web/src/features/chat/use-message-actions.ts` — 新建消息操作 hook

**实现示例**：
```tsx
<div className="group relative">
  <div className="message-content">...</div>
  
  <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
    <button 
      onClick={() => copy(content)}
      className="rounded p-1 hover:bg-bg-subtle"
      title="复制"
    >
      <Copy className="h-4 w-4" />
    </button>
    
    {role === 'assistant' && (
      <button 
        onClick={() => regenerate()}
        className="rounded p-1 hover:bg-bg-subtle"
        title="重新生成"
      >
        <RotateCw className="h-4 w-4" />
      </button>
    )}
    
    <button 
      onClick={() => feedback('up')}
      className="rounded p-1 hover:bg-bg-subtle"
      title="点赞"
    >
      <ThumbsUp className="h-4 w-4" />
    </button>
  </div>
</div>
```

**验收标准**：
- [ ] 悬停消息显示操作按钮
- [ ] 复制成功后显示 Toast 提示
- [ ] 重新生成会清空当前流式输出
- [ ] 反馈按钮点击后高亮（已反馈状态）

---

### 2.2 快捷键提示与支持

**现状**：输入框没有快捷键提示，新用户不知道 `Shift+Enter` 可以换行。

**目标**：
- 输入框底部显示快捷键提示
- 支持快捷键：
  - `Enter` — 发送消息
  - `Shift+Enter` — 插入换行
  - `Ctrl/Cmd + K` — 清空输入框
  - `Escape` — 停止生成

**文件变更**：
- `web/src/features/chat/input-bar.tsx` — 添加快捷键提示和事件处理

**实现示例**：
```tsx
<div className="px-4 py-2 text-center text-xs text-fg-muted">
  <kbd className="rounded bg-muted px-1.5 py-0.5">Enter</kbd> 发送
  <span className="mx-2">·</span>
  <kbd className="rounded bg-muted px-1.5 py-0.5">Shift</kbd> + 
  <kbd className="rounded bg-muted px-1.5 py-0.5">Enter</kbd> 换行
</div>

// 快捷键处理
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
  
  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    setText('');
  }
  
  if (e.key === 'Escape' && streaming) {
    e.preventDefault();
    onStop();
  }
};
```

**验收标准**：
- [ ] 输入框底部显示快捷键提示
- [ ] `Shift+Enter` 正确换行
- [ ] `Cmd/Ctrl+K` 清空输入框
- [ ] `Escape` 停止流式输出

---

### 2.3 附件预览优化

**现状**：附件上传后没有预览，用户不知道上传了什么。

**目标**：
- 图片附件显示缩略图（可点击查看大图）
- 文件附件显示文件名 + 大小 + 类型图标
- 支持删除附件（上传后、发送前）

**技术方案**：
- 图片缩略图：`object-fit: cover` + 固定尺寸
- 文件图标：根据 MIME 类型显示不同图标（PDF、Word、Excel 等）
- 大图预览：`<dialog>` 元素或 Lightbox 组件

**文件变更**：
- `web/src/features/chat/attachment-display.tsx` — 优化附件预览组件
- `web/src/features/chat/image-lightbox.tsx` — 新建图片大图查看组件
- `web/src/lib/file-icons.tsx` — 文件类型图标映射

**实现示例**：
```tsx
// 图片缩略图
<div className="relative h-20 w-20 overflow-hidden rounded">
  <img 
    src={attachment.url} 
    alt={attachment.name}
    className="h-full w-full object-cover cursor-pointer"
    onClick={() => openLightbox(attachment.url)}
  />
  <button 
    className="absolute right-1 top-1 rounded-full bg-black/50 p-1"
    onClick={() => removeAttachment(attachment.id)}
  >
    <X className="h-3 w-3 text-white" />
  </button>
</div>

// 文件附件
<div className="flex items-center gap-2 rounded border p-2">
  <FileIcon type={attachment.mimeType} className="h-8 w-8" />
  <div className="flex-1 min-w-0">
    <div className="text-sm font-medium truncate">{attachment.name}</div>
    <div className="text-xs text-fg-muted">{formatFileSize(attachment.size)}</div>
  </div>
  <button onClick={() => removeAttachment(attachment.id)}>
    <X className="h-4 w-4" />
  </button>
</div>
```

**验收标准**：
- [ ] 图片附件显示缩略图
- [ ] 点击缩略图查看大图
- [ ] 文件附件显示正确图标和大小
- [ ] 删除按钮正常工作

---

### 2.4 会话管理增强

**现状**：会话列表只读，无法编辑标题、搜索、归档。

**目标**：
1. 会话标题可编辑（点击 ✏️ 图标）
2. 会话列表支持搜索（按标题/内容）
3. 右键菜单：重命名、归档、删除

**技术方案**：
- **编辑标题**：双击或点击编辑图标进入编辑模式，`Enter` 保存，`Escape` 取消
- **搜索**：输入框过滤 `conversations` 列表
- **右键菜单**：`onContextMenu` 触发自定义菜单

**文件变更**：
- `web/src/features/chat/session-list.tsx` — 添加编辑、搜索、右键菜单
- `web/src/features/chat/use-conversations.ts` — 添加 `updateTitle`、`archive`、`delete` mutation

**实现示例**：
```tsx
// 编辑标题
const [editing, setEditing] = useState(false);
const [title, setTitle] = useState(conversation.title);

{editing ? (
  <input
    value={title}
    onChange={(e) => setTitle(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        updateTitle.mutate({ id: conversation.id, title });
        setEditing(false);
      }
      if (e.key === 'Escape') setEditing(false);
    }}
    autoFocus
    className="flex-1 rounded border px-2 py-1"
  />
) : (
  <>
    <span className="flex-1 truncate">{conversation.title}</span>
    <button onClick={() => setEditing(true)}>
      <Pencil className="h-3 w-3" />
    </button>
  </>
)}

// 搜索框
<input
  type="search"
  placeholder="搜索会话..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
  className="w-full rounded border px-3 py-2"
/>

// 右键菜单
<div
  onContextMenu={(e) => {
    e.preventDefault();
    showContextMenu({ x: e.clientX, y: e.clientY, conversationId });
  }}
>
  {/* 会话列表项 */}
</div>
```

**验收标准**：
- [ ] 双击标题进入编辑模式
- [ ] 搜索框实时过滤会话
- [ ] 右键显示重命名/归档/删除菜单
- [ ] 删除前弹出确认对话框

---

### 2.5 多模态输入入口

**现状**：只有文本输入框，无附件上传入口。

**目标**：底部输入栏左侧添加：
- 📎 附件上传（图片、PDF、文档）
- 📷 截图粘贴（`Ctrl/Cmd+V`）
- 🎤 语音输入（可选，Phase 3）

**技术方案**：
- **附件上传**：`<input type="file" multiple accept="image/*,.pdf,.docx" />`
- **截图粘贴**：监听 `paste` 事件，提取 `clipboard.files`
- **拖拽上传**：`onDrop` 事件

**文件变更**：
- `web/src/features/chat/input-bar.tsx` — 添加附件上传按钮和拖拽区域
- `web/src/features/chat/use-attachment-upload.ts` — 扩展截图粘贴支持

**实现示例**：
```tsx
// 附件上传按钮
<input
  ref={fileInputRef}
  type="file"
  multiple
  accept="image/*,.pdf,.docx,.xlsx"
  className="hidden"
  onChange={handleFileSelect}
/>
<button onClick={() => fileInputRef.current?.click()}>
  <Paperclip className="h-5 w-5" />
</button>

// 截图粘贴
const handlePaste = (e: React.ClipboardEvent) => {
  const items = Array.from(e.clipboardData.items);
  const imageItems = items.filter(item => item.type.startsWith('image/'));
  
  imageItems.forEach(item => {
    const file = item.getAsFile();
    if (file) uploadFile(file);
  });
};

<textarea onPaste={handlePaste} />

// 拖拽上传
<div
  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
  onDragLeave={() => setDragging(false)}
  onDrop={(e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadFile);
  }}
  className={dragging ? 'border-primary bg-primary/5' : ''}
>
  {/* 输入框区域 */}
</div>
```

**验收标准**：
- [ ] 点击 📎 按钮选择文件上传
- [ ] `Ctrl/Cmd+V` 粘贴截图自动上传
- [ ] 拖拽文件到输入框上传
- [ ] 上传进度条显示

---

### 2.6 消息引用功能

**现状**：无法引用历史消息，上下文依赖时需要复制粘贴。

**目标**：
- 点击历史消息显示"引用"按钮
- 引用后输入框上方显示引用卡片
- 发送时将引用上下文一并发送

**技术方案**：
- 引用卡片存储被引用消息的 `id` 和部分 `content`（前 100 字）
- 后端接收 `replyToMessageId` 字段
- 助手回复时可以看到被引用的消息

**文件变更**：
- `web/src/features/chat/message-bubble.tsx` — 添加引用按钮
- `web/src/features/chat/input-bar.tsx` — 显示引用卡片
- `web/src/features/chat/use-chat-stream.ts` — 发送时携带 `replyToMessageId`

**实现示例**：
```tsx
// 引用按钮
<button 
  onClick={() => setQuotedMessage({ id: message.id, content: message.content })}
  className="text-xs text-fg-muted hover:text-primary"
>
  💬 引用
</button>

// 引用卡片
{quotedMessage && (
  <div className="mx-4 mt-2 flex items-start gap-2 rounded border border-primary/30 bg-primary/5 p-2">
    <Quote className="h-4 w-4 text-primary" />
    <div className="flex-1 min-w-0">
      <div className="text-xs text-fg-muted">引用消息：</div>
      <div className="text-sm truncate">{quotedMessage.content}</div>
    </div>
    <button onClick={() => setQuotedMessage(null)}>
      <X className="h-4 w-4" />
    </button>
  </div>
)}
```

**验收标准**：
- [ ] 点击"引用"按钮显示引用卡片
- [ ] 引用卡片显示原消息前 100 字
- [ ] 发送时后端收到 `replyToMessageId`
- [ ] 助手回复考虑引用上下文

---

### 2.7 导出对话功能

**现状**：无法导出对话历史。

**目标**：右上角添加"导出"按钮，支持：
- 导出为 Markdown
- 导出为 PDF（可选）
- 分享对话链接（可选，需权限控制）

**技术方案**：
- **Markdown 导出**：遍历 `messages`，拼接成 Markdown 字符串，触发下载
- **PDF 导出**：使用 `jsPDF` 或后端生成
- **分享链接**：后端生成短链 + 访问令牌

**文件变更**：
- `web/src/features/chat/chat-window.tsx` — 添加导出按钮
- `web/src/features/chat/use-export-conversation.ts` — 新建导出 hook
- `backend/src/modules/conversation/conversation.controller.ts` — 添加导出接口

**实现示例**：
```tsx
const exportAsMarkdown = () => {
  const markdown = messages
    .map(m => `### ${m.role === 'USER' ? '用户' : employee.name}\n\n${m.content}\n`)
    .join('\n---\n\n');
  
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conversation.title || '对话'}.md`;
  a.click();
  URL.revokeObjectURL(url);
};

<button onClick={exportAsMarkdown} title="导出对话">
  <Download className="h-4 w-4" />
</button>
```

**验收标准**：
- [ ] 点击导出按钮触发下载
- [ ] Markdown 格式正确（用户/助手消息分开）
- [ ] 文件名包含会话标题
- [ ] 可选：PDF 导出包含样式

---

## Phase 3：性能优化与高级功能（P2，2-3 天）

### 3.1 虚拟滚动（长对话性能优化）

**现状**：对话超过 100 条时，DOM 节点过多，滚动卡顿。

**目标**：使用虚拟滚动，只渲染可视区域的消息。

**技术方案**：
- 使用 `@tanstack/react-virtual` 库
- 计算每条消息的动态高度（因为内容长度不一）
- 保留滚动位置（新消息到达时自动滚到底部）

**文件变更**：
- `web/src/features/chat/chat-window.tsx` — 集成虚拟滚动
- `package.json` — 添加 `@tanstack/react-virtual` 依赖

**实现示例**：
```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const parentRef = useRef<HTMLDivElement>(null);

const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 100, // 平均高度
  overscan: 5, // 预渲染 5 条
});

<div ref={parentRef} className="h-full overflow-y-auto">
  <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
    {virtualizer.getVirtualItems().map(item => (
      <div
        key={item.key}
        data-index={item.index}
        ref={virtualizer.measureElement}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${item.start}px)`,
        }}
      >
        <MessageBubble {...messages[item.index]} />
      </div>
    ))}
  </div>
</div>
```

**验收标准**：
- [ ] 长对话（200+ 条）滚动流畅
- [ ] 滚动位置正确保持
- [ ] 新消息到达自动滚到底部

---

### 3.2 图片懒加载

**现状**：所有图片立即加载，首屏性能差。

**目标**：离屏图片延迟加载，进入视口时再加载。

**技术方案**：
- 原生 `<img loading="lazy">`（优先）
- 或使用 `IntersectionObserver`

**文件变更**：
- `web/src/features/chat/attachment-display.tsx` — 图片添加 `loading="lazy"`

**实现示例**：
```tsx
<img 
  src={attachment.url} 
  alt={attachment.name}
  loading="lazy"
  className="h-full w-full object-cover"
/>
```

**验收标准**：
- [ ] 离屏图片不立即加载
- [ ] 滚动到视口时图片加载
- [ ] 加载时显示占位符

---

### 3.3 会话列表优化

**现状**：会话列表左侧粉色选中背景不够优雅。

**目标**：
- 选中态改为左侧 4px 主题色竖线 + 淡灰背景
- 添加左内边距动画
- 悬停态轻微背景色变化

**样式调整**：
```css
.session-item {
  position: relative;
  padding: 12px 16px;
  transition: all 0.15s ease;
}

.session-item:hover {
  background: hsl(var(--muted) / 0.5);
  padding-left: 20px;
}

.session-item.active {
  background: hsl(var(--muted));
  padding-left: 20px;
}

.session-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 4px;
  background: hsl(var(--primary));
  border-radius: 0 4px 4px 0;
}
```

**文件变更**：
- `web/src/features/chat/session-list.tsx` — 调整选中态样式

**验收标准**：
- [ ] 选中态有左侧竖线
- [ ] 背景色淡雅（非粉色）
- [ ] 悬停态有轻微动画

---

### 3.4 模型切换器视觉强化

**现状**：模型切换器只有文字，不够直观。

**目标**：
- 添加模型图标（OpenAI/DeepSeek/Gemini 等）
- 悬停显示模型详情卡片（上下文长度、价格）
- 切换时加载动画

**技术方案**：
- 模型图标：根据 `vendor` 字段映射图标
- 详情卡片：`Tooltip` 组件或自定义浮层
- 加载动画：`Loader2` 图标旋转

**文件变更**：
- `web/src/features/chat/model-switcher.tsx` — 添加图标和 Tooltip
- `web/src/lib/model-icons.tsx` — 模型图标映射

**实现示例**：
```tsx
const MODEL_ICONS: Record<string, React.ReactNode> = {
  'OpenAI': <img src="/icons/openai.svg" className="h-4 w-4" />,
  'DeepSeek': <img src="/icons/deepseek.svg" className="h-4 w-4" />,
  'Gemini': <img src="/icons/gemini.svg" className="h-4 w-4" />,
};

<Tooltip content={
  <div className="text-xs">
    <div className="font-medium">{currentModel.label}</div>
    <div className="text-fg-muted">上下文: {formatContext(currentModel.contextLength)}</div>
    <div className="text-fg-muted">价格: {formatPrice(currentModel.pricingInputPer1M)} / 1M tokens</div>
  </div>
}>
  <button className="...">
    {MODEL_ICONS[currentModel.vendor] || <Cpu className="h-4 w-4" />}
    <span>{currentModel.label}</span>
    {switchModel.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
  </button>
</Tooltip>
```

**验收标准**：
- [ ] 模型切换器显示厂商图标
- [ ] 悬停显示详情卡片
- [ ] 切换时显示加载动画

---

## 数据库变更

### 新增字段

#### `messages` 表
```sql
ALTER TABLE messages
ADD COLUMN "replyToMessageId" TEXT,
ADD CONSTRAINT "fk_messages_reply_to" FOREIGN KEY ("replyToMessageId") REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX "idx_messages_reply_to" ON messages("replyToMessageId");
```

#### `message_feedbacks` 表（新建）
```sql
CREATE TABLE "message_feedbacks" (
  "id" TEXT PRIMARY KEY DEFAULT gen_cuid(),
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "feedbackType" TEXT NOT NULL CHECK ("feedbackType" IN ('up', 'down')),
  "comment" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "fk_message_feedback_message" FOREIGN KEY ("messageId") REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT "fk_message_feedback_user" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT "uq_message_user_feedback" UNIQUE ("messageId", "userId")
);

CREATE INDEX "idx_message_feedbacks_message" ON message_feedbacks("messageId");
CREATE INDEX "idx_message_feedbacks_user" ON message_feedbacks("userId");
```

---

## API 新增接口

### 1. 更新会话标题
```
PATCH /conversations/:id/title
Body: { title: string }
```

### 2. 归档会话
```
POST /conversations/:id/archive
```

### 3. 删除会话
```
DELETE /conversations/:id
```

### 4. 消息反馈
```
POST /messages/:id/feedback
Body: { feedbackType: 'up' | 'down', comment?: string }
```

### 5. 导出会话
```
GET /conversations/:id/export?format=markdown|pdf
Returns: File download
```

---

## 测试计划

### 单元测试
- [ ] Markdown 渲染组件（`markdown.spec.tsx`）
- [ ] 时间戳格式化工具（`utils.spec.ts`）
- [ ] 消息操作 hook（`use-message-actions.spec.ts`）
- [ ] 附件上传 hook（`use-attachment-upload.spec.ts`）

### 集成测试
- [ ] 会话 CRUD（创建、重命名、归档、删除）
- [ ] 消息发送与引用
- [ ] 附件上传与预览
- [ ] 模型切换

### E2E 测试（Playwright）
- [ ] 完整对话流程（发送消息、流式回复、停止生成）
- [ ] 附件上传与预览
- [ ] 会话管理（重命名、搜索、删除）
- [ ] 导出对话

---

## 风险与依赖

### 技术风险
- **虚拟滚动实现复杂度**：动态高度计算可能有性能瓶颈 → 可先用固定高度简化
- **PDF 导出兼容性**：`jsPDF` 对中文支持有限 → 可用后端 Puppeteer 生成

### 外部依赖
- `@tanstack/react-virtual` — 虚拟滚动
- `jsPDF` 或 Puppeteer — PDF 导出
- `highlight.js` 或 `prism-react-renderer` — 代码高亮

---

## 里程碑

| Phase | 功能 | 预计完成 | 负责人 |
|-------|------|----------|--------|
| Phase 1 | Markdown 渲染、时间戳、流式视觉反馈、气泡样式 | D+4 | TBD |
| Phase 2 | 消息操作、快捷键、附件预览、会话管理、引用、导出 | D+11 | TBD |
| Phase 3 | 虚拟滚动、图片懒加载、列表优化、模型切换器强化 | D+14 | TBD |

---

## 验收标准

### Phase 1 完成标准
- [ ] Markdown 正确渲染（列表、代码、引用）
- [ ] 每条消息显示时间戳
- [ ] 流式输出有闪烁光标
- [ ] 用户/助手气泡有明显视觉区分

### Phase 2 完成标准
- [ ] 可复制消息、重新生成回复
- [ ] 快捷键正常工作
- [ ] 附件上传后有预览
- [ ] 会话标题可编辑
- [ ] 可导出为 Markdown

### Phase 3 完成标准
- [ ] 200+ 条消息滚动流畅
- [ ] 图片懒加载生效
- [ ] 会话列表选中态优雅
- [ ] 模型切换器有图标和详情

---

## 附录：设计规范

### 颜色变量
```css
--primary: 主题色（按钮、链接、高亮）
--muted: 浅灰背景（助手消息、输入框）
--border: 边框色
--fg: 主文本色
--fg-muted: 次要文本色
--fg-subtle: 最淡文本色（时间戳、提示）
```

### 圆角规范
- 消息气泡：`18px`（对话感）
- 卡片/模态框：`12px`
- 按钮：`8px`
- 输入框：`8px`

### 间距规范
- 消息之间：`20px`
- 内容内边距：`12px 16px`
- 按钮内边距：`8px 16px`

### 字体大小
- 消息内容：`14px`（`text-sm`）
- 时间戳：`12px`（`text-xs`）
- 标题：`16px`（`text-base`）
- 小提示：`11px`（`text-[11px]`）

---

**文档版本**：v1.0  
**最后更新**：2026-08-19  
**维护者**：SEP 开发团队

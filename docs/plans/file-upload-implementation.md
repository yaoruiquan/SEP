# 文件上传功能实现方案

## 目标
实现对话中的多模态输入，支持上传图片、文档、视频等文件，并通过对象存储服务持久化。

## 技术选型

### 对象存储服务
- **首选**: 阿里云 OSS (Object Storage Service)
- **备选**: 腾讯云 COS, AWS S3
- **本地开发**: MinIO (Docker 部署)

### 文件类型支持
- **图片**: jpg, jpeg, png, gif, webp (最大 10MB)
- **文档**: pdf, doc, docx, txt, md (最大 20MB)
- **视频**: mp4, mov (最大 100MB) - 可选，Phase 2

## 实现步骤

### 1. 后端实现

#### 1.1 环境变量配置
```bash
# .env
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=your_access_key
OSS_ACCESS_KEY_SECRET=your_secret
OSS_BUCKET=sep-chat-files
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
```

#### 1.2 安装依赖
```bash
cd backend
pnpm add ali-oss
pnpm add -D @types/ali-oss
```

#### 1.3 创建 Upload 模块
```
backend/src/modules/upload/
├── upload.module.ts
├── upload.controller.ts
├── upload.service.ts
└── oss.service.ts
```

**upload.controller.ts**:
- `POST /upload/file` - 单文件上传，返回 URL
- `POST /upload/files` - 多文件上传 (最多 5 个)
- 使用 `@nestjs/platform-express` 的 `FileInterceptor`

**oss.service.ts**:
- `uploadFile(buffer, filename, mimetype)` - 上传到 OSS
- `deleteFile(objectKey)` - 删除文件
- `getSignedUrl(objectKey)` - 生成临时访问链接

#### 1.4 Message 模型扩展
```prisma
model Message {
  // ... 已有字段
  
  // 🆕 附件列表 (JSON 数组)
  attachments Json? // [{ type: 'image', url: 'https://...', name: 'file.png', size: 12345 }]
}
```

迁移命令:
```bash
pnpm db:migrate add_message_attachments
pnpm db:generate
```

#### 1.5 MessageSendDto 扩展
```typescript
// backend/src/shared/index.ts
export const MessageAttachmentSchema = z.object({
  type: z.enum(['image', 'document', 'video']),
  url: z.string().url(),
  name: z.string(),
  size: z.number(),
  mimeType: z.string().optional(),
});

export const MessageSendDtoSchema = z.object({
  content: z.string().min(1).max(10000),
  targetEmployeeId: z.string().optional(),
  attachments: z.array(MessageAttachmentSchema).max(5).optional(), // 🆕
});
```

#### 1.6 修改 ConversationStreamService
- 接收 `attachments` 参数
- 持久化到 Message 表
- 将附件信息注入到 AI 提示词 (图片 → URL，文档 → 提取文本)

### 2. 前端实现

#### 2.1 安装依赖
```bash
cd web
pnpm add react-dropzone
```

#### 2.2 创建上传组件
```
web/src/features/chat/
├── file-upload-button.tsx  # 上传按钮 + 文件选择
├── file-preview.tsx         # 已选文件预览
└── attachment-display.tsx   # 消息中的附件显示
```

**file-upload-button.tsx**:
- 使用 `<input type="file" multiple />` 或 `react-dropzone`
- 支持拖拽上传
- 文件类型和大小验证
- 上传进度显示

**file-preview.tsx**:
- 缩略图预览 (图片)
- 文件名 + 大小 (文档)
- 删除按钮

**attachment-display.tsx**:
- 图片: 可点击放大查看
- 文档: 显示图标 + 文件名 + 下载链接
- 视频: 内嵌播放器

#### 2.3 修改 InputBar
```tsx
// input-bar.tsx
interface InputBarProps {
  // ... 已有 props
  onSend: (text: string, targetEmployeeId?: string, attachments?: Attachment[]) => void;
}

// 新增状态
const [attachments, setAttachments] = useState<Attachment[]>([]);
const [uploading, setUploading] = useState(false);

// 上传处理
const handleUpload = async (files: File[]) => {
  setUploading(true);
  const uploaded = await uploadFiles(files); // API 调用
  setAttachments([...attachments, ...uploaded]);
  setUploading(false);
};

// 发送时带上附件
const submit = () => {
  onSend(text, selectedEmployeeId, attachments);
  setAttachments([]); // 清空
};
```

#### 2.4 修改 ChatWindow
```tsx
const handleSend = (text: string, targetEmployeeId?: string, attachments?: Attachment[]) => {
  send(conversationId, text, targetEmployeeId, attachments, () => {
    // ...
  });
};
```

#### 2.5 修改 MessageBubble
```tsx
// message-bubble.tsx
interface MessageBubbleProps {
  // ... 已有 props
  attachments?: Attachment[];
}

// 渲染附件
{attachments && attachments.length > 0 && (
  <AttachmentDisplay attachments={attachments} />
)}
```

### 3. API 客户端

```typescript
// web/src/lib/api.ts
export async function uploadFiles(files: File[]): Promise<Attachment[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));

  const res = await fetch('/api/upload/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
    body: formData,
  });

  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}
```

## 安全考虑

1. **文件类型校验**
   - 前端: MIME type 检查
   - 后端: Magic number 验证 (防绕过)

2. **文件大小限制**
   - 前端: 提前拦截
   - 后端: NestJS `MaxFileSizeValidator`

3. **存储隔离**
   - OSS 路径: `{enterpriseId}/{userId}/{timestamp}_{filename}`
   - 防止文件名冲突和越权访问

4. **临时链接**
   - 使用 OSS 签名 URL (1 小时有效期)
   - 不暴露永久公开链接

5. **病毒扫描** (可选，Phase 2)
   - 集成 ClamAV 或云服务

## 开发排期

| 任务 | 工期 | 负责人 |
|------|------|--------|
| 后端 OSS 集成 + Upload 模块 | 0.5 天 | 瑞泉 |
| Message 模型扩展 + 迁移 | 0.5 天 | 瑞泉 |
| ConversationStream 修改 | 0.5 天 | 瑞泉 |
| 前端上传组件 | 0.5 天 | 小冯 |
| 前端附件显示 | 0.5 天 | 小冯 |
| 测试 + 优化 | 0.5 天 | 全员 |
| **总计** | **3 天** | |

## 测试计划

1. **单元测试**
   - OssService.uploadFile()
   - 文件类型验证器

2. **集成测试**
   - 上传 → 发送消息 → 接收 → 显示附件
   - 多文件上传
   - 大文件上传失败处理

3. **性能测试**
   - 并发上传 10 个文件
   - 100MB 视频上传时间

4. **安全测试**
   - 非法文件类型上传 (.exe, .sh)
   - 超大文件 (200MB)
   - 文件名注入攻击

## 降级方案

如果 OSS 集成时间不够:
1. **Phase 1**: 文件存本地 `/uploads` 目录
2. **Phase 2**: 迁移到 OSS

## 参考资料

- [阿里云 OSS Node.js SDK](https://help.aliyun.com/document_detail/32068.html)
- [NestJS File Upload](https://docs.nestjs.com/techniques/file-upload)
- [React Dropzone](https://react-dropzone.js.org/)

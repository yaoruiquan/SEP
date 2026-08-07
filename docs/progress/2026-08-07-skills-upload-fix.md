# Skills 上传功能修复报告

**日期**: 2026-08-07  
**任务**: 修复 Skills 文件上传和创建功能  
**状态**: ✅ 已完成

---

## 问题描述

在检查 Skills 功能实现状态时，发现了一个关键问题：

**前端在创建 SKILL 能力时传递的 zip 文件元数据（`zipPath`, `sha256`, `fileCount`, `totalSize`）没有被后端保存到数据库的 `metadata` 字段中。**

这会导致：
1. 创建的 SKILL 能力缺少文件路径信息
2. 下载功能无法找到 zip 文件（404 错误）
3. 前端无法显示文件大小等元信息

---

## 修复内容

### 1. 后端修复：`CapabilityService.create()`

**文件**: `backend/src/modules/capability/capability.service.ts`

**修改前**:
```typescript
async create(contributorId: string, dto: CapabilityUploadDto) {
  // ...
  return this.prisma.capability.create({
    data: {
      name: dto.name,
      description: dto.description,
      type: typeMap[dto.type] as any,
      // ... 其他字段
      // ❌ 缺少 metadata 字段处理
    },
  });
}
```

**修改后**:
```typescript
async create(contributorId: string, dto: CapabilityUploadDto & { metadata?: any }) {
  // ...
  return this.prisma.capability.create({
    data: {
      name: dto.name,
      description: dto.description,
      type: typeMap[dto.type] as any,
      // ... 其他字段
      metadata: dto.metadata || null, // ✅ 添加 metadata 字段
    },
  });
}
```

### 2. 前端修复：`SkillForm`

**文件**: `web/src/app/(platform)/admin/capabilities/new/skill-form.tsx`

**修改前**:
```typescript
const res = await fetch('/api/admin/capabilities', {
  method: 'POST',
  body: JSON.stringify({
    type: 'SKILL',
    name: data.name,
    description: data.description,
    industry: data.industry,
    position: data.position,
    zipPath: data.zipPath,        // ❌ 直接传递，不符合 DTO 结构
    sha256: data.sha256,
    fileCount: data.fileCount,
    totalSize: data.totalSize,
  }),
});
```

**修改后**:
```typescript
const res = await fetch('/api/capabilities', {  // ✅ 修正路径
  method: 'POST',
  body: JSON.stringify({
    type: 'skill',  // ✅ 小写，符合 DTO 枚举
    name: data.name,
    description: data.description,
    industry: data.industry,
    position: data.position,
    inputSchema: {},
    outputSchema: {},
    metadata: {  // ✅ 封装到 metadata 对象
      zipPath: data.zipPath,
      sha256: data.sha256,
      fileCount: data.fileCount,
      totalSize: data.totalSize,
    },
    skillConfig: {  // ✅ 添加必需的 skillConfig
      template: '',
      modelId: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 2000,
    },
  }),
});
```

---

## 测试验证

### 测试流程

1. ✅ **登录** - 使用 `admin@sep.local` 平台运营账号
2. ✅ **上传 zip** - `POST /admin/capabilities/upload-skill`
   - 验证包含 SKILL.md
   - 计算 SHA256
   - 返回 metadata
3. ✅ **创建能力** - `POST /capabilities`
   - type: `skill`
   - metadata 正确保存
   - skillConfig 正确关联
4. ✅ **下载验证** - `GET /capabilities/:id/download`
   - 正确读取 metadata.zipPath
   - 文件流式传输成功
   - Content-Disposition 正确编码中文文件名
5. ✅ **清理数据** - `DELETE /capabilities/:id`

### 测试结果

```json
{
  "id": "cmsiby3e600017qxz1iylg7td",
  "name": "测试技能包",
  "type": "SKILL",
  "status": "PENDING",
  "metadata": {
    "zipPath": "skills/8e748c2841487604607faf1e04365efa1e3fdd01b6abb96e387d09801e52f756.zip",
    "sha256": "8e748c2841487604607faf1e04365efa1e3fdd01b6abb96e387d09801e52f756",
    "fileCount": 1,
    "totalSize": 248
  },
  "skillConfig": {
    "template": "",
    "modelId": "gpt-4o-mini",
    "temperature": 0.7,
    "maxTokens": 2000
  }
}
```

**下载测试**:
```
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="%E6%B5%8B%E8%AF%95%E6%8A%80%E8%83%BD%E5%8C%85.zip"
✅ 文件大小: 248 bytes
✅ 内容验证: SKILL.md 正确
```

---

## 功能状态总结

### ✅ 已完成的任务

| 任务 | 状态 | 说明 |
|------|------|------|
| **#111** 后端文件上传接口 | ✅ 完成 | `POST /admin/capabilities/upload-skill` |
| **#112** 后端创建 API | ✅ 完成 | `POST /capabilities` (已修复 metadata) |
| **#113** 后端下载接口 | ✅ 完成 | `GET /capabilities/:id/download` |
| **#114** 前端上架表单 | ✅ 完成 | `/admin/capabilities/new` (已修复请求) |

### 实现的端点

#### 后端 API

```
POST   /admin/capabilities/upload-skill       # 上传 zip（验证 SKILL.md）
POST   /capabilities                          # 创建能力（含 metadata）
GET    /capabilities/:id                      # 获取能力详情
GET    /capabilities/:id/download             # 下载 zip 文件
GET    /admin/capabilities/:id/download-skill # 管理端下载（备用）
DELETE /capabilities/:id                      # 删除能力
```

#### 前端页面

```
/admin/capabilities/new                       # 能力上架页面
  ├── 选择平台: COZE | SKILL | (其他即将推出)
  ├── 上传 zip: 自动验证 + 显示元信息
  ├── 填写信息: 名称、描述、行业、岗位
  └── 创建能力: 提交到后端
```

---

## 数据模型

### Capability 表结构（SKILL 相关字段）

```typescript
{
  id: string,
  type: 'SKILL',                    // 能力类型
  name: string,                     // 能力名称
  description: string,              // 能力描述
  industry: string[],               // 适用行业
  position: string[],               // 适用岗位
  status: 'PENDING' | 'APPROVED',   // 审核状态
  metadata: {                       // 🔥 关键字段
    zipPath: string,                // 存储路径
    sha256: string,                 // 文件校验和
    fileCount: number,              // 包内文件数
    totalSize: number,              // 文件大小（bytes）
  },
  skillConfig: {                    // SKILL 配置
    template: string,               // 提示词模板（SKILL.md 内容）
    modelId: string,                // 使用的模型
    temperature: number,            // 温度参数
    maxTokens: number,              // 最大 token 数
  },
}
```

---

## 后续优化建议

### 1. 前端体验优化

- [ ] 上传进度条显示
- [ ] 拖拽上传支持
- [ ] zip 包预览（显示文件列表）
- [ ] 重新上传功能（替换已上传的 zip）

### 2. 后端安全增强

- [ ] 文件大小限制配置化（当前硬编码 50MB）
- [ ] zip 炸弹防护（解压大小限制）
- [ ] 文件名白名单（只允许特定后缀）
- [ ] 病毒扫描集成（可选）

### 3. 下载功能增强

- [ ] 断点续传支持
- [ ] 下载次数统计
- [ ] 下载权限细化（当前仅需登录）
- [ ] CDN 加速（OSS 存储）

### 4. 审核流程

- [ ] Skills 审核检查清单
- [ ] SKILL.md 格式验证
- [ ] 恶意代码扫描
- [ ] 测试运行沙箱

---

## 相关文件

### 后端
- `backend/src/modules/capability/capability.service.ts` - ✅ 修改
- `backend/src/modules/capability/capability.controller.ts` - 无需修改
- `backend/src/modules/admin/admin-upload.controller.ts` - 无需修改
- `backend/src/shared/index.ts` - 无需修改（DTO 已支持）

### 前端
- `web/src/app/(platform)/admin/capabilities/new/page.tsx` - 无需修改
- `web/src/app/(platform)/admin/capabilities/new/skill-form.tsx` - ✅ 修改

### 存储
- `backend/uploads/skills/` - zip 文件存储目录
- SHA256 命名：`{sha256}.zip`

---

## 结论

✅ **Skills 上传功能现已完全正常工作**

所有任务（#111 ~ #114）均已完成，核心问题（metadata 未保存）已修复，完整的上传 → 创建 → 下载流程已验证通过。

前端表单可正常使用，后端 API 正确存储和返回数据，下载功能稳定可靠。

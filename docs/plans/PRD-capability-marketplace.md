# 能力市场 PRD - 上架与分发

**日期**: 2026-08-01  
**版本**: v1.0  
**定位**: 能力分发中心（不做执行）

---

## 一、核心理念

平台不承载能力执行，只做**能力注册 + 审核 + 分发**。

```
贡献者上架 → 运营审核 → 企业浏览 → 绑定员工 → 用户使用（外部平台）
```

**使用方式**：
- **Coze**：跳转到 Coze 平台对话
- **Skills**：下载 zip，用户导入到 `.claude/skills/`
- **RPA**：下载包，用户导入到实在/影刀平台

---

## 二、三种类型设计

### 1. AGENT（Coze）

#### 上架表单
```
基础信息：
  - name: 智能体名称
  - description: 功能描述
  - industry[]: 适用行业（多选）
  - position[]: 适用岗位（多选）

Coze 配置：
  - botId: Coze Bot ID（必填）
  - publicUrl: Coze 分享链接（选填，审核时用）
  
Schema（JSON）：
  - inputSchema: 输入参数定义
  - outputSchema: 输出结果定义
```

#### 存储
```prisma
Capability {
  type: AGENT
}
AgentConfig {
  platform: COZE
  botId: string
  apiKey: null  // 跳转模式不需要
}
```

#### 审核检查
- [ ] Coze Bot ID 有效性（调 Coze API 验证）
- [ ] publicUrl 可访问（如果提供）
- [ ] 元数据完整性

#### 使用流程
```
企业绑定到员工
  ↓
用户在"我的员工"看到卡片
  ↓
点击"打开对话" → 新窗口跳转到 Coze 平台
  ↓
URL: https://www.coze.cn/space/{space_id}/bot/{bot_id}
```

---

### 2. SKILL（Claude Code 技能包）

#### 上架表单
```
基础信息：同上

技能包上传：
  - 上传 zip 文件（< 50MB）
  - 解压后检查：
    ✓ 必须包含 SKILL.md
    ✓ 可选：README.md, .mcp.json, scripts/, references/
    ✓ 不允许：可执行文件（.exe, .sh），除非在白名单

Schema：
  - inputSchema: 技能输入参数
  - outputSchema: 技能输出结果
```

#### 存储
```prisma
Capability {
  type: SKILL
  metadata: {
    zipUrl: 'oss://skills/phase2-cnvd-report-v1.0.zip',
    zipSha256: 'abc123...',
    fileCount: 42,
    totalSize: 1024000
  }
}
SkillConfig {
  template: null        // 不用了，zip 里有 SKILL.md
  modelId: null
  temperature: null
  maxTokens: null
}
```

**注意**：SkillConfig 表暂时不删，但字段留空。未来如果要做"纯提示词模板"类型的 skill，可以复用。

#### 审核检查
- [ ] zip 包结构合法（有 SKILL.md）
- [ ] 无恶意文件（病毒扫描、可执行文件检查）
- [ ] 文件大小 < 50MB
- [ ] SKILL.md 格式正确（frontmatter 存在）

#### 使用流程
```
企业绑定到员工（仅标记，不实际下发）
  ↓
用户在"我的员工"看到"Skills (3)"
  ↓
点击展开 → 显示技能列表 + "下载" 按钮
  ↓
点击下载 → 下载 zip → 用户手动解压到 ~/.claude/skills/
  ↓
用户在 Claude Code 中调用（如 /phase2-cnvd-report）
```

**优化方向**（Phase 2）：
- 提供一键导入脚本（`curl | bash`）
- 或提供 Claude Code 插件，自动同步

---

### 3. RPA（实在/影刀工作流）

#### 上架表单
```
基础信息：同上

RPA 配置：
  - platform: 实在智能 | 影刀
  - executionMode: download（MVP 只做这个）
  - 上传 zip 文件（< 100MB）
  - configDoc: 使用说明（Markdown）
```

#### 存储
```prisma
Capability {
  type: RPA
}
RPAConfig {
  platform: SHIZAI | YINGDAO
  executionMode: DOWNLOAD
  packageUrl: 'oss://rpa/bulk-upload-v1.0.zip'
  packageSha256: 'def456...'
  configDoc: '## 使用说明\n1. 下载...'
}
```

#### 审核检查
- [ ] zip 包结构合法（根据平台校验）
- [ ] 无恶意代码
- [ ] configDoc 完整性

#### 使用流程
```
企业绑定到员工
  ↓
用户在"我的员工"看到"RPA (2)"
  ↓
点击展开 → 显示 RPA 列表 + "下载" + "查看说明"
  ↓
下载 zip → 手动导入到实在/影刀平台
  ↓
在 RPA 平台执行
```

---

## 三、实施优先级

### Phase 1: Coze（最快验证）
- [x] DB Schema 已就绪
- [ ] 后端：Coze 上架 API（POST /admin/capabilities）
- [ ] 后端：审核 API（PATCH /admin/capabilities/:id/review）
- [ ] 前端：Coze 上架表单（4 个字段 + botId）
- [ ] 前端：审核页面（一键通过/拒绝）
- [ ] 前端：员工详情页显示绑定的 Coze Bot + 跳转按钮

**验收**：创建一个 Coze Bot → 上架 → 审核通过 → 绑定员工 → 点击跳转能打开 Coze

---

### Phase 2: Skills
- [ ] 后端：文件上传（OSS）+ zip 解析
- [ ] 后端：Skills 上架 API
- [ ] 前端：Skills 上架表单（zip 上传）
- [ ] 前端：Skills 下载页（列表 + 下载按钮）

**验收**：上传一个 skills zip → 审核 → 绑定员工 → 用户下载 → 导入 Claude Code 可用

---

### Phase 3: RPA
- [ ] 同 Skills 流程，调整为 RPA 平台校验逻辑

---

## 四、数据流

### 上架流程
```
POST /admin/capabilities
{
  "type": "AGENT",
  "name": "竞品分析助手",
  "description": "...",
  "industry": ["电商", "零售"],
  "position": ["市场分析", "运营"],
  "inputSchema": {...},
  "outputSchema": {...},
  "agentConfig": {
    "platform": "COZE",
    "botId": "7388906506363559947"
  }
}

→ status: PENDING
→ 运营后台审核
→ PATCH /admin/capabilities/:id/review { "action": "approve" }
→ status: APPROVED
```

### 绑定流程
```
POST /admin/employees/:id/bindings
{
  "capabilityIds": ["cap_abc123"]
}

→ EmployeeCapabilityBinding 创建
```

### 使用流程（Coze）
```
GET /my-employees/:id
→ 返回绑定的能力列表，包含：
  {
    "id": "cap_abc123",
    "name": "竞品分析助手",
    "type": "AGENT",
    "launchUrl": "https://www.coze.cn/space/.../bot/7388906506363559947"
  }

前端渲染"打开对话"按钮 → window.open(launchUrl)
```

### 使用流程（Skills）
```
GET /my-employees/:id
→ 返回：
  {
    "id": "skill_xyz",
    "name": "CNVD 报告生成",
    "type": "SKILL",
    "downloadUrl": "https://oss.../skills/phase2-cnvd-report-v1.0.zip"
  }

前端渲染"下载"按钮 → <a href={downloadUrl} download>
```

---

## 五、技术细节

### 文件上传（Skills / RPA）
```typescript
// 前端
const file = form.file;  // zip 文件
const formData = new FormData();
formData.append('file', file);
formData.append('type', 'SKILL');

await fetch('/admin/capabilities/upload', {
  method: 'POST',
  body: formData,
});

// 后端
@Post('upload')
@UseInterceptors(FileInterceptor('file'))
async uploadFile(@UploadedFile() file: Express.Multer.File) {
  // 1. 校验 zip 格式
  // 2. 解压到临时目录，检查结构
  // 3. 上传到 OSS
  // 4. 返回 { ossUrl, sha256, fileCount, totalSize }
}
```

### Coze Bot ID 验证
```typescript
// capability.service.ts
async validateCozeBot(botId: string): Promise<boolean> {
  // 调 Coze API: GET /open_api/v2/bots/{bot_id}
  // 如果返回 200 → 有效
  // 如果返回 404 → 无效
}
```

### OSS 配置
```
阿里云 OSS Bucket:
  - sep-capabilities/
    - skills/
      - phase2-cnvd-report-v1.0.zip
    - rpa/
      - bulk-upload-v1.0.zip
    
访问权限: 私有（需签名 URL）
签名有效期: 1 小时
```

---

## 六、前端页面结构

### 运营后台（/admin）

#### 能力管理（/admin/capabilities）
```
Tab: 待审核 (0) | 已发布 (12) | 全部

表格列：
  - 能力名称
  - 类型（Badge: AGENT/SKILL/RPA）
  - 贡献者
  - 提交时间
  - 状态（Badge: pending/approved/rejected）
  - 操作（查看详情 | 审核）

+ 新建能力（下拉菜单）:
  - 创建 Agent（智能体）
  - 创建 Skill（技能包）
  - 创建 RPA（流程自动化）
```

#### 能力上架表单（/admin/capabilities/new?type=agent）
```
步骤 1: 基础信息
  - 名称
  - 描述
  - 行业（多选 Checkbox）
  - 岗位（多选 Checkbox）

步骤 2: 类型配置（根据 type 动态渲染）
  [AGENT]:
    - Coze Bot ID
    - 公开链接（选填）
  
  [SKILL]:
    - 上传 zip 文件
    - 拖拽上传区域
  
  [RPA]:
    - 选择平台（实在/影刀）
    - 上传 zip 文件
    - 使用说明（Markdown 编辑器）

步骤 3: Schema 定义
  - 输入 Schema（JSON 编辑器）
  - 输出 Schema（JSON 编辑器）

提交 → 状态变为 PENDING
```

#### 能力审核页（/admin/capabilities/:id/review）
```
左侧：能力详情
  - 基础信息展示
  - 类型配置展示
  - Schema 展示

右侧：审核操作
  [ 测试运行 ]  # Coze: 打开 Bot 链接测试
                # Skill: 下载 zip 查看
  
  审核决策：
    ○ 通过  ○ 拒绝
    拒绝原因（Textarea，拒绝时必填）
  
  [ 提交审核 ]
```

### 企业端（/my-employees）

#### 员工详情页（/my-employees/:id）
```
Tab: 概览 | 绑定能力 | 运行日志 | 监控

绑定能力 Tab:
  - Coze Bot (2)
    ┌─────────────────────────┐
    │ 竞品分析助手              │
    │ 电商行业 · 市场分析       │
    │ [打开对话] [解绑]         │
    └─────────────────────────┘
  
  - Skills (3)
    ┌─────────────────────────┐
    │ CNVD 报告生成             │
    │ 安全 · 渗透测试          │
    │ [下载] [查看说明] [解绑]  │
    └─────────────────────────┘
  
  - RPA (1)
    ┌─────────────────────────┐
    │ 商品批量上架              │
    │ 电商 · 运营              │
    │ [下载] [查看说明] [解绑]  │
    └─────────────────────────┘
```

---

## 七、API 设计

### 能力上架
```
POST /admin/capabilities
Body: {
  type: 'AGENT' | 'SKILL' | 'RPA',
  name: string,
  description: string,
  industry: string[],
  position: string[],
  inputSchema: object,
  outputSchema: object,
  
  // 类型特定配置
  agentConfig?: { platform: 'COZE', botId: string },
  skillConfig?: { zipUrl: string, sha256: string },
  rpaConfig?: { platform: 'SHIZAI' | 'YINGDAO', packageUrl: string, configDoc: string }
}
Response: { id: string, status: 'PENDING' }
```

### 审核
```
PATCH /admin/capabilities/:id/review
Body: {
  action: 'approve' | 'reject',
  reason?: string  // reject 时必填
}
Response: { status: 'APPROVED' | 'REJECTED' }
```

### 获取能力详情（含启动信息）
```
GET /my-employees/:id
Response: {
  ...employee,
  capabilities: [
    {
      id: string,
      name: string,
      type: 'AGENT' | 'SKILL' | 'RPA',
      launchUrl?: string,      // AGENT: Coze URL
      downloadUrl?: string,    // SKILL/RPA: OSS 签名 URL
      configDoc?: string       // RPA: 使用说明
    }
  ]
}
```

---

## 八、风险与限制

### 安全风险
- **Skills/RPA zip 包可能包含恶意代码** → 沙箱扫描 + 人工审核
- **Coze Bot 可能包含不当内容** → 人工测试审核

### 用户体验
- **Skills 手动下载安装门槛高** → Phase 2 提供一键导入脚本
- **Coze 跳转体验割裂** → 未来可考虑 iframe 嵌入（需 Coze 支持）

### 数据一致性
- **用户下载后平台无法追踪使用情况** → Skills/RPA 无法统计 usageCount
- **Coze Bot 修改后平台不感知** → 需要定期重新验证

---

## 九、后续优化方向

### Phase 2（Q4）
- [ ] Skills 一键导入（CLI 工具）
- [ ] Coze iframe 嵌入模式（需调研 Coze API）
- [ ] 能力市场（企业端浏览所有能力）
- [ ] 能力评分与评论

### Phase 3（2027 Q1）
- [ ] Skills 在线编辑器（Web IDE）
- [ ] RPA 云端执行（对接实在 API）
- [ ] AI App 类型（iframe/api 模式）

---

**最后更新**: 2026-08-01  
**负责人**: @yao

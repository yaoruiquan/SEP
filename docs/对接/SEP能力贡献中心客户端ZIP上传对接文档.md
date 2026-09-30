# SEP 能力贡献中心客户端 ZIP 上传对接文档

版本：v1.0  
更新日期：2026-09-30  
适用范围：SEP 桌面客户端或其他已登录客户端中的能力贡献功能

## 1. 接口审计结论

Skill ZIP 上传、创建贡献草稿、查询本人贡献、提交审核、创建 Skill 新版本和提交版本审核等接口均已存在，无需新增上传或投稿 API。

审计时发现企业贡献者迭代已公开 Skill 后，版本通过企业审核却没有进入平台审核队列的状态转换。本次已补齐：企业管理员通过已公开能力的新版本后，服务端会保留企业版本，并生成单独的平台待审版本；不需要客户端额外调用新接口。

当前范围外的限制：

- 没有删除贡献草稿的接口；客户端可保留草稿或继续编辑允许修改的字段。
- RPA 支持首次 ZIP 投稿和审核流程，当前没有 RPA 版本迭代接口。
- 后端还支持 Agent 类型及 Skill 在线正文来源；本客户端对接约定只使用 Skill ZIP 与 RPA ZIP，不调用这些其他来源。

## 2. 通用约定

- API 根地址：`https://<SEP 域名>/api`
- 除登录等公开接口外，贡献接口都需要用户 Access Token：`Authorization: Bearer <accessToken>`。
- JSON 接口使用 `Content-Type: application/json`。
- 上传接口使用 `multipart/form-data`，文件字段名固定为 `file`。使用客户端 FormData 时不要手动设置 Content-Type，让 HTTP 库生成 boundary。
- 请求需要绑定当前用户身份。企业归属、版本作用域和审核权限由服务端从登录身份推导，客户端不得提交或覆盖这些字段。
- 成功响应是 JSON；二进制下载接口除外。错误响应使用 HTTP 状态码，常见为 `400` 参数或包校验失败、`401` 登录失效、`403` 无权限、`404` 资源不可见或不存在、`409` 当前状态不允许该操作、`413` 上传超限。

## 3. Skill ZIP 投稿

### 3.1 准备压缩包

ZIP 中必须有一个 `SKILL.md`，可位于包根目录或子目录。文件需要包含非空 Markdown 正文；建议保留 `name`、`description` frontmatter，便于客户端预填投稿信息。

```text
weekly-report.zip
└── weekly-report/
    ├── SKILL.md
    └── references/
        └── examples.md
```

服务端限制：ZIP 压缩文件最大 20 MiB；最多 500 个条目；解压后总大小最大 64 MiB；`SKILL.md` 最大 500 KiB。服务端校验 ZIP 格式、路径和重复条目，并运行内容自动校验；不会执行 ZIP 中的脚本。

### 3.2 上传并取得服务端摘要

```http
POST /api/contributions/skill-package
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data; boundary=...
```

cURL 示例：

```bash
curl -X POST "$SEP_API_BASE/contributions/skill-package" \
  -H "Authorization: Bearer $SEP_ACCESS_TOKEN" \
  -F "file=@weekly-report.zip;type=application/zip"
```

成功响应（`201 Created`，节选）：

```json
{
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "filename": "weekly-report.zip",
  "fileCount": 2,
  "totalBytes": 4096,
  "content": "# 角色\n你是周报助手。\n# 输入\n...",
  "suggested": {
    "name": "weekly-report",
    "description": "根据输入生成周报"
  },
  "validation": {
    "valid": true,
    "checks": [{ "code": "CONTENT_LENGTH", "passed": true, "message": "Skill 正文至少需要 20 个字符" }],
    "issues": [],
    "warnings": []
  }
}
```

使用规则：

- `sha256` 是服务端对收到的 ZIP 字节计算的 64 位小写 SHA-256。创建草稿时必须回传它。
- `filename` 是服务端处理后的展示文件名。创建草稿时建议原样回传。
- `content` 是服务端从 `SKILL.md` 提取的正文，仅供预览；创建草稿不要把它作为正文再次上传。
- `suggested` 来自 SKILL.md frontmatter，可用于预填能力名称和说明。
- `validation.valid=false` 时展示 `issues` 并要求贡献者更换 ZIP；不要继续创建或提交审核。`warnings` 是提示信息。
- 重新选择 ZIP 时重新调用上传接口，并使用最新响应中的摘要。

### 3.3 创建贡献草稿

```http
POST /api/contributions
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "name": "周报生成器",
  "description": "读取业务和项目进度信息，按团队模板生成结构化周报。",
  "type": "skill",
  "industry": ["软件服务"],
  "position": ["项目管理"],
  "inputSchema": {},
  "outputSchema": {},
  "skillConfig": {
    "packageSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "packageFilename": "weekly-report.zip"
  }
}
```

字段要求：

| 字段 | 类型 | 要求 |
|---|---|---|
| `name` | string | 必填，1 至 100 字符 |
| `description` | string | 必填，10 至 2000 字符 |
| `type` | string | Skill ZIP 投稿固定为 `skill` |
| `industry` | string[] | 可选，默认空数组 |
| `position` | string[] | 可选，默认空数组 |
| `inputSchema` | object | 可选，默认 `{}` |
| `outputSchema` | object | 可选，默认 `{}` |
| `skillConfig.packageSha256` | string | 必填，使用上传响应里的 SHA-256 |
| `skillConfig.packageFilename` | string | 可选，最长 120 字符 |

创建成功返回贡献能力对象，客户端至少保存其 `id`，后续查询、送审和版本迭代都使用该 ID。服务端按 SHA-256 重新读取 ZIP，不接受客户端提供的替代正文。

### 3.4 首次发布审核流程

先通过 `GET /api/contributions/:id` 或 `GET /api/contributions/mine` 读取最新状态，再按身份和状态调用：

| 贡献者类型 | 调用 | 结果 |
|---|---|---|
| 无企业归属的个人贡献者 | `POST /api/contributions/:id/request-platform-review` | 自动校验通过后直接进入平台审核队列 |
| 企业贡献者 | `POST /api/contributions/:id/submit-enterprise-review` | 进入企业管理员审核 |
| 企业管理员已通过，贡献者申请公开发布 | `POST /api/contributions/:id/request-platform-review` | 状态变为等待企业管理员授权 |
| 企业管理员授权公开发布 | `POST /api/contributions/:id/authorize-platform-submission` | 创建平台审核版本并进入平台审核队列 |

审核决定由有权限的企业管理员或平台运营提交，普通贡献者客户端不应代替审核人调用审核接口。企业管理员授权和平台审核结果可通过贡献详情中的审核状态查询。

### 3.5 查看和编辑贡献

| 方法与路径 | 用途 |
|---|---|
| `GET /api/contributions/overview` | 贡献中心统计 |
| `GET /api/contributions/mine` | 当前用户可见的贡献列表；企业管理员还可见本企业贡献 |
| `GET /api/contributions/:id` | 贡献详情、审核状态及 Skill 版本 |
| `PATCH /api/contributions/:id` | 编辑未在审核中的贡献名称、说明、行业、岗位和输入输出 Schema；不能替换已上传 ZIP |
| `GET /api/contributions/:id/usage` | 查看能力使用情况 |
| `GET /api/contributions/rewards` | 查看当前用户奖励事件 |

已上传 ZIP 的正文不可在线改写。需要更换 Skill 内容时，使用新版本流程上传新的 ZIP。

## 4. Skill 版本迭代

### 4.1 上传新 ZIP

继续调用 `POST /api/contributions/skill-package`。校验规则及响应字段与首次投稿相同。

### 4.2 创建版本草稿

```http
POST /api/contributions/:capabilityId/versions
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "packageSha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  "packageFilename": "weekly-report-v2.zip",
  "changeSummary": "补充异常输入处理和周报缺项提示",
  "parentVersionId": "version_abc123"
}
```

`changeSummary` 必填，1 至 1000 字符；`packageSha256` 使用本次上传接口返回值；`parentVersionId` 可选，示例中的值仅表示字段格式，省略时由服务端选择当前作用域最新版本或当前公开版本。该接口返回新版本对象，客户端保存其 `id`。

### 4.3 提交版本审核

```http
POST /api/contributions/versions/:versionId/submit
Authorization: Bearer <accessToken>
```

个人贡献版本通过自动校验后直接进入平台审核。企业贡献版本先进入企业审核；若能力已在市场公开，企业管理员通过后，服务端会自动创建一个独立的平台待审副本。原企业版本仍保留在企业作用域。客户端通过 `GET /api/contributions/:capabilityId` 刷新版本和审核状态。

作者可用以下接口展示版本详情、差异、审核记录和已上传 ZIP：

| 方法与路径 | 用途 |
|---|---|
| `GET /api/contributions/versions/:versionId` | 作者查看版本正文和状态 |
| `GET /api/contributions/versions/:versionId/diff` | 查看与父版本差异和审核记录 |
| `GET /api/contributions/versions/:versionId/package` | 下载该版本 ZIP；响应头含 `X-SHA256`、`X-Version` |

已上传包的版本不能使用 `PATCH /api/contributions/versions/:versionId` 修改正文；应上传新包并创建新版本。只有在线正文来源的版本允许该 PATCH，但 ZIP 客户端不使用它。

## 5. RPA ZIP 首次投稿

若客户端也需要贡献 RPA，可复用审核和贡献管理接口，但上传及创建字段不同：

1. `POST /api/contributions/rpa-package`，multipart 字段 `file`，最大 50 MiB；响应含 `sha256`、`filename`、`fileCount`、`totalBytes`、`uncompressedBytes`、`files`。
2. `POST /api/contributions`，请求使用 `type: "rpa"`，并提供：

```json
{
  "rpaConfig": {
    "platform": "shizai",
    "executionMode": "download",
    "packageSha256": "上传响应中的 SHA-256",
    "packageFilename": "invoice-flow.zip",
    "configDoc": "说明运行平台版本、导入步骤、环境要求和注意事项。"
  }
}
```

`platform` 为 `shizai` 或 `yingdao`；`configDoc` 为 10 至 10000 字符。后续首次审核使用第 3.4 节的贡献审核流程。当前没有 RPA 新版本迭代 API。

## 6. 客户端实现要点

- 上传成功后缓存当前 `sha256` 与 `filename`，创建贡献或版本时只提交这两个字段。
- Access Token 过期时按 SEP 登录系统刷新后重试；不要把 Refresh Token 写入请求 JSON，Refresh Token 由认证流程通过 httpOnly Cookie 管理。
- 对 `400` 展示服务端 `message` 和上传响应中的 `validation.issues`；对 `409` 先刷新贡献状态，避免重复送审。
- 投稿创建与审核提交分开处理。创建草稿成功不代表已提交审核或已公开。
- 列表/详情的状态以服务端为准，不在客户端自行推导企业归属、审核通过或市场可见状态。

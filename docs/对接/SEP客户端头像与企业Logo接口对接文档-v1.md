# SEP 客户端用户头像与企业 Logo 接口对接文档

- **文档版本**：v1.0
- **适用客户端**：SEP 桌面客户端
- **更新时间**：2026-09-28
- **接口前缀**：`/api`

## 1. 结论与接口范围

此前 Web 端已经具备用户头像和企业 Logo 的上传、读取能力，但桌面客户端登录响应没有完整返回这两类展示字段，客户端也没有统一的资料刷新接口。

本次补齐后的推荐对接方式是：

1. 登录成功后直接读取 `POST /api/client/auth/login` 返回的 `user.avatar` 和 `enterprise.logo`；
2. 刷新 access token 后读取 `POST /api/client/auth/refresh` 返回的同名字段；
3. 客户端启动、切换页面或需要刷新展示资料时调用 `GET /api/client/profile`；
4. 对图片字段使用服务端返回的路径拼接 API Base URL 后加载，不要自行拼接存储桶路径，也不要把图片内容写入本地数据库。

已存在的公开图片读取接口：

- 用户头像：`GET /api/users/avatars/:filename`
- 企业 Logo：`GET /api/enterprise/logos/:filename`

这两个读取接口不要求 `Authorization` 请求头，因为桌面客户端和浏览器图片加载通常不会为 `<img>` 或图片组件自动附加 Bearer Token。文件名由服务端生成并经过白名单校验；客户端不得把任意本地路径或用户输入直接拼接到图片 URL 中。

## 2. Base URL 与鉴权

假设部署域名为：

```text
https://api.example.com
```

则完整接口地址为：

```text
https://api.example.com/api/client/profile
https://api.example.com/api/client/auth/login
https://api.example.com/api/client/auth/refresh
```

客户端登录接口返回的 `accessToken` 用于调用受保护接口：

```http
Authorization: Bearer <accessToken>
```

`refreshToken` 只用于刷新，不得作为图片读取接口或普通业务接口的 Bearer Token。

> 桌面端 refresh token 是响应体返回值，客户端应使用操作系统安全存储（例如 Windows Credential Manager、macOS Keychain、Linux Secret Service 或应用使用的同等安全存储），不要明文写入普通配置文件、日志或 localStorage。

## 3. 登录响应中的头像和 Logo

### 3.1 请求

```http
POST /api/client/auth/login
Content-Type: application/json
```

请求示例：

```json
{
  "email": "user@example.com",
  "password": "your-password",
  "fingerprint": "stable-device-fingerprint",
  "platform": "windows",
  "clientVersion": "0.1.0"
}
```

> 具体登录 DTO 以当前客户端登录对接文档和后端 OpenAPI 为准；上面只展示与本次头像/Logo 相关的使用上下文。

### 3.2 响应重点字段

```json
{
  "accessToken": "<access-token>",
  "refreshToken": "<refresh-token>",
  "accessTokenExpiresIn": 3600,
  "refreshTokenExpiresIn": 2592000,
  "user": {
    "id": "user_cuid",
    "email": "user@example.com",
    "name": "张三",
    "avatar": "/api/users/avatars/2f4d0e87-7f68-4a2b-9e9e-6a7b8c9d0e1f.webp",
    "role": "USER"
  },
  "enterprise": {
    "id": "enterprise_cuid",
    "name": "龙道集团",
    "logo": "/api/enterprise/logos/3a6f3e4a-3b68-4a3a-a49d-2f0a5c5d9a11.png"
  },
  "devices": []
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user.avatar` | `string \| null` | 当前用户头像路径；没有头像时为 `null` |
| `enterprise` | `object \| null` | 当前用户最早创建的企业归属；无企业时为 `null` |
| `enterprise.logo` | `string \| null` | 企业 Logo 路径；企业没有 Logo 时为 `null` |

当前系统是单企业归属模式。客户端不应自行传入 `enterpriseId` 来决定读取哪家公司的 Logo，服务端会根据 access token 对应的用户身份解析企业归属。

## 4. Token 刷新响应

### 4.1 请求

```http
POST /api/client/auth/refresh
Content-Type: application/json
```

```json
{
  "refreshToken": "<refresh-token>"
}
```

### 4.2 响应重点字段

刷新成功后响应中的 `user` 和 `enterprise` 同样包含最新头像和 Logo：

```json
{
  "accessToken": "<new-access-token>",
  "refreshToken": "<rotated-refresh-token>",
  "accessTokenExpiresIn": 3600,
  "refreshTokenExpiresIn": 2592000,
  "user": {
    "id": "user_cuid",
    "email": "user@example.com",
    "name": "张三",
    "avatar": "/api/users/avatars/new-avatar.webp",
    "role": "USER"
  },
  "enterprise": {
    "id": "enterprise_cuid",
    "name": "龙道集团",
    "logo": "/api/enterprise/logos/new-logo.png"
  }
}
```

刷新令牌采用轮换机制。客户端必须用响应中的新 `refreshToken` 覆盖旧值；如果刷新失败，不应无限重试，应回到登录页。

## 5. 资料刷新接口（推荐）

### 5.1 接口

```http
GET /api/client/profile
Authorization: Bearer <accessToken>
```

### 5.2 成功响应 `200`

```json
{
  "user": {
    "id": "user_cuid",
    "email": "user@example.com",
    "name": "张三",
    "avatar": "/api/users/avatars/2f4d0e87-7f68-4a2b-9e9e-6a7b8c9d0e1f.webp",
    "role": "USER"
  },
  "enterprise": {
    "id": "enterprise_cuid",
    "name": "龙道集团",
    "logo": "/api/enterprise/logos/3a6f3e4a-3b68-4a3a-a49d-2f0a5c5d9a11.png"
  }
}
```

### 5.3 无头像、无 Logo、无企业

用户尚未上传头像：

```json
{
  "user": {
    "id": "user_cuid",
    "email": "user@example.com",
    "name": null,
    "avatar": null,
    "role": "USER"
  },
  "enterprise": null
}
```

可能的状态：

| 情况 | 返回值 | 客户端处理 |
| --- | --- | --- |
| 有头像 | `user.avatar` 为路径 | 加载头像 |
| 无头像 | `user.avatar = null` | 显示默认头像、首字母或本地占位图 |
| 有企业无 Logo | `enterprise.logo = null` | 显示企业默认 Logo 或企业名称首字母 |
| 无企业归属 | `enterprise = null` | 隐藏企业 Logo 区域或显示“未加入企业” |

## 6. 图片 URL 拼接规则

服务端返回的是根相对路径，例如：

```text
/api/users/avatars/xxx.webp
/api/enterprise/logos/yyy.png
```

客户端应使用配置的 API Base URL 拼接：

```text
https://api.example.com + /api/users/avatars/xxx.webp
https://api.example.com + /api/enterprise/logos/yyy.png
```

如果 API Base URL 末尾已经有 `/`，应先规范化，避免出现 `//api`。如果服务端未来返回 `https://...` 形式的绝对 URL，客户端应直接使用，不要重复拼接 Base URL。

伪代码：

```ts
function resolveAssetUrl(apiBaseUrl: string, assetPath: string | null): string | null {
  if (!assetPath) return null;
  if (/^https?:\\/\\//i.test(assetPath)) return assetPath;
  return `${apiBaseUrl.replace(/\\/$/, '')}/${assetPath.replace(/^\\//, '')}`;
}
```

## 7. 缓存、更新与失败回退

### 7.1 缓存建议

- 可以使用客户端图片缓存，建议缓存 1 小时至 24 小时；
- 不要永久缓存头像和 Logo；
- 新头像或新 Logo 会生成新的 UUID 文件名，服务端路径会改变，因此不需要在 URL 上额外追加时间戳；
- 收到登录、刷新或 `GET /api/client/profile` 的新路径后，应替换内存中的展示资料和图片缓存 key；
- 退出登录时清理内存中的当前用户资料，按产品安全策略清理本地图片缓存。

### 7.2 图片加载失败

收到 `404`、网络错误或图片解码错误时：

- 用户头像：显示默认头像或用户名称首字母；
- 企业 Logo：显示企业名称首字母或产品默认 Logo；
- 不要因为图片加载失败而退出登录；
- 可以在网络恢复后重新调用 `GET /api/client/profile`，但应有退避，避免循环请求。

### 7.3 URL 变化处理

上传发生在 Web 端或运营端后台后，桌面客户端不会自动收到推送通知。客户端在以下时机重新拉取资料：

- 登录成功后；
- access token 刷新成功后；
- 客户端从后台恢复到前台；
- 用户打开个人资料/企业资料页面；
- 图片加载失败且本地资料可能过期时。

## 8. Web 管理端上传接口（客户端一般不调用）

以下接口是管理端/用户资料页面使用的上传接口，桌面客户端通常只需要读取返回路径：

### 用户头像上传

```http
POST /api/users/me/avatar
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

表单字段：`file`

限制：PNG、JPEG、WebP，最大 2MB。

响应：

```json
{
  "avatar": "/api/users/avatars/xxx.webp"
}
```

### 企业 Logo 上传

```http
POST /api/enterprise/logo
Authorization: Bearer <enterprise-admin-accessToken>
Content-Type: multipart/form-data
```

表单字段：`file`

限制：仅企业管理员可上传，PNG、JPEG、WebP，最大 2MB。

响应：

```json
{
  "logo": "/api/enterprise/logos/xxx.png"
}
```

如果未来桌面客户端需要支持上传，应复用这两个接口，并遵守企业管理员权限，不要在客户端复制一套存储逻辑。

## 9. 状态码

| 状态码 | 场景 | 客户端处理 |
| --- | --- | --- |
| `200` | 资料查询或 Token 刷新成功 | 更新本地资料 |
| `401` | access token 缺失、过期或无效 | 先按既定流程刷新；刷新失败则要求重新登录 |
| `403` | 用户无企业归属但调用了企业专属接口 | 不把它当作账号失效；企业信息按空状态处理 |
| `404` | 图片文件不存在或已被替换 | 使用 fallback，不退出登录 |
| `429` | 触发限流 | 延迟重试，避免立即循环请求 |
| `5xx` | 服务端或存储暂时异常 | 使用缓存/fallback，并按网络重试策略处理 |

## 10. 客户端实现示例

```ts
type ClientProfile = {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar: string | null;
    role: string;
  };
  enterprise: {
    id: string;
    name: string;
    logo: string | null;
  } | null;
};

async function loadClientProfile(
  apiBaseUrl: string,
  accessToken: string,
): Promise<ClientProfile> {
  const response = await fetch(`${apiBaseUrl}/api/client/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`profile request failed: ${response.status}`);
  }

  return response.json() as Promise<ClientProfile>;
}

function assetUrl(apiBaseUrl: string, path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\\/\\//i.test(path)) return path;
  return `${apiBaseUrl.replace(/\\/$/, '')}/${path.replace(/^\\//, '')}`;
}
```

图片使用：

```ts
const avatarUrl = assetUrl(apiBaseUrl, profile.user.avatar);
const logoUrl = assetUrl(apiBaseUrl, profile.enterprise?.logo ?? null);

// avatarUrl / logoUrl 为 null 时显示本地 fallback。
```

## 11. 联调清单

1. 客户端成功登录，确认登录响应包含 `user.avatar` 和 `enterprise.logo`；
2. 用户有头像时，使用完整 URL 请求图片返回 `200`；
3. 企业管理员上传新 Logo 后，客户端重新调用 `GET /api/client/profile` 能拿到新路径；
4. 没有头像时接口返回 `avatar: null`，而不是字符串 `"null"`；
5. 没有企业时接口返回 `enterprise: null`；
6. access token 失效时 `GET /api/client/profile` 返回 `401`，客户端能走刷新流程；
7. 图片接口返回正确的 `Content-Type`，并能处理 PNG、JPEG、WebP；
8. 图片接口返回 `404` 时，客户端显示 fallback，不强制退出；
9. 刷新 Token 后保存新的 `refreshToken`，并使用刷新响应中的最新头像/Logo；
10. 日志中不得打印 access token、refresh token、密码或完整图片 URL 中的私密签名参数。

## 12. OpenAPI 查看

开发环境通常可从以下地址查看 Swagger：

```text
http://localhost:3000/api/docs
```

生产环境请将域名替换为实际 API 域名。客户端正式接入前，建议以部署环境的 OpenAPI 文档和本文件共同核对响应字段。

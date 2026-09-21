# SEP 客户端发行下载地址交付 Web 端说明-v1

> 更新时间：2026-09-21
>
> 适用版本：SEP Client `0.1.0-beta`
>
> 文档用途：将客户端安装包地址、校验信息和上线检查项交付给 Web 端开发者。
> 最新验收：2026-09-21 下载响应头修复后，三个平台安装包均通过本地官网 Chromium 点击下载与完整文件 SHA-256 复核，详见第 9 节；不代表 Web 已部署或安装运行已验收。

## 1. 交付结论

客户端 `0.1.0-beta` 的三个发行包已经上传到下载服务器，并通过公网 HTTPS 验证。Web 端无需将安装包提交到 Git，只需要在发行配置中维护对应的 HTTPS 地址。

下载域名：`https://download.longdaoSEP.cn`

当前发行目标只有以下三个平台：

| 平台 | 架构 | 文件名 | 下载地址 |
| --- | --- | --- | --- |
| macOS Apple 芯片 | ARM64（M1/M2/M3/M4） | `SEP-Client-0.1.0-mac-arm64.dmg` | <https://download.longdaoSEP.cn/sep-client/beta/0.1.0/SEP-Client-0.1.0-mac-arm64.dmg> |
| macOS Intel 芯片 | x64 | `SEP-Client-0.1.0-mac-x64.dmg` | <https://download.longdaoSEP.cn/sep-client/beta/0.1.0/SEP-Client-0.1.0-mac-x64.dmg> |
| Windows | x64 | `SEP-Client-0.1.0-win-x64.exe` | <https://download.longdaoSEP.cn/sep-client/beta/0.1.0/SEP-Client-0.1.0-win-x64.exe> |

## 2. Web 端接入位置

客户端发行配置文件：

```text
web/src/config/client-releases.ts
```

当前配置应保持以下约定：

- `version` 为 `0.1.0`。
- `platform` 只保留 `macos-arm64`、`macos-x64`、`windows-x64`。
- `url` 使用上表中的 HTTPS 地址，不使用服务器内网路径或 IP 地址。
- 安装包不复制到 Web 仓库，也不通过 Git LFS 管理。
- 下载菜单在 `url` 不为空时显示可用下载操作；未配置的版本可继续使用 `url: null` 表示“准备中”。

## 3. 文件完整性校验

服务器上的 `SHA256SUMS.txt` 内容如下：

```text
97f26a9a066d3a9b550755395fe2667e97fd51d30fc5c87f386332fa08d4e937  SEP-Client-0.1.0-mac-arm64.dmg
8a623e8e6006bf6c80ed2ea093818ef6d2164a84025ba85fccf141848487a40c  SEP-Client-0.1.0-mac-x64.dmg
1047ba679b02bd3264c8a7fdaa689f5d50a9035a9bd57216d8d47dfca515addb  SEP-Client-0.1.0-win-x64.exe
```

校验清单地址：

<https://download.longdaoSEP.cn/sep-client/beta/0.1.0/SHA256SUMS.txt>

## 4. 已完成的服务端验证

2026-09-21 已从公网完成以下验证：

- `download.longdaoSEP.cn` DNS 可解析。
- HTTPS 使用 Let’s Encrypt 证书，证书有效期为 2026-09-21 至 2026-12-20。
- 三个安装包请求均返回 `HTTP/2 200`。
- 三个安装包均支持 Range 断点下载，部分请求返回 `206 Partial Content`。
- 文件响应由 Caddy 提供，响应包含 `X-Content-Type-Options: nosniff`。
- 服务器文件 SHA-256 与 `SHA256SUMS.txt` 一致。

Web 端可以使用以下命令复核地址是否可用：

```bash
curl -sSIL https://download.longdaoSEP.cn/sep-client/beta/0.1.0/SEP-Client-0.1.0-mac-arm64.dmg
curl -sSIL https://download.longdaoSEP.cn/sep-client/beta/0.1.0/SEP-Client-0.1.0-mac-x64.dmg
curl -sSIL https://download.longdaoSEP.cn/sep-client/beta/0.1.0/SEP-Client-0.1.0-win-x64.exe
```

预期结果：状态为 `200`，并能看到 `server: Caddy` 和合理的 `content-length`。

## 5. Web 发布前检查

发布 Web 端前请确认：

1. 下载菜单展示三个平台，且没有 Linux 选项。
2. macOS Apple 芯片、macOS Intel、Windows 三个按钮分别打开对应 URL。
3. 下载地址使用 HTTPS，页面上不显示服务器 IP、内网目录或 SSH 信息。
4. 版本号显示为 `0.1.0` 或产品约定的 beta 版本标识。
5. 浏览器实际点击后能够开始下载，不能只验证前端配置字符串。
6. Web 构建和 TypeScript 检查通过后，再部署到生产环境。

## 6. 当前发行限制

本次安装包是集成环境 beta 构建，构建时间为 `2026-09-20T09:14:20.759Z`。当前安装包尚未配置：

- macOS Developer ID 签名；
- macOS notarization（公证）；
- Windows Authenticode 签名；
- OSS/CDN 自动上传。

因此，正式发行前仍应补充三平台签名和公证，并重新生成安装包、校验和及下载地址。当前地址适合 Web 端联调和 beta 下载，不应在正式发布说明中表述为“已签名的正式版”。

## 7. 客户端来源记录

- 客户端仓库：`https://github.com/12456756/sep-client`
- 构建分支：`refactor/backend-structure`
- 构建提交：`a46e1be873a7`
- 发行目录：`/sep-client/beta/0.1.0/`

后续升级客户端版本时，请同步更新 `client-releases.ts` 中的版本号、文件名和 URL，并重新执行本文件第 3～5 节的校验流程。

## 8. Web 端首次复核记录（2026-09-21，修复前）

> **首次验收结论（历史记录）：Web 三个地址已配置，但当时尚不能认定三个平台均可直接下载。Mac 下载响应头需要修复后复验。** 本节为交付后实测结果，对前文“公网可用”的结论补充浏览器验收边界。

### 8.1 已完成

- 保留交付方对 `web/src/config/client-releases.ts` 的三个 URL 修改，版本号为 `0.1.0`。
- 官网仍是“浏览硅基人才市场”旁的下载按钮，悬浮展示 Apple 芯片、Intel、Windows 三项，直接链接安装包；未新增下载页面或下载代理。
- 新增菜单回归测试：校验三个平台与文件名、HTTPS 地址一一对应，下载项启用且不再显示“准备中”。菜单测试 **3/3 通过**。
- Web TypeScript 检查、生产构建通过。验证基于当前工作区，不代表已部署。
- 三个安装包的公网 HEAD 请求均为 `200`，两个 DMG 的 Range 请求实测为 `206`。
- 公网 `SHA256SUMS.txt` 与第 3 节清单一致；Windows 安装包经本地官网真实浏览器点击下载完成，SHA-256 为 `1047ba679b02bd3264c8a7fdaa689f5d50a9035a9bd57216d8d47dfca515addb`，与清单一致。未对两个 Mac 安装包完成本次全量文件哈希复验。

### 8.2 阻塞项：Mac 安装包被浏览器作为页面打开

本地官网使用真实 Chromium 浏览器点击 Apple 芯片安装包时，未收到下载事件，而是导航到 DMG 地址并显示二进制乱码。Intel 安装包点击后也导航到文件地址，未触发下载事件。公网复核发现 **两个 DMG 的响应均未包含 `Content-Type` 和 `Content-Disposition`**，同时带有 `X-Content-Type-Options: nosniff`。

Windows 的响应包含 `Content-Type: application/octet-stream`，真实点击可触发下载并保持官网页面。单纯 HEAD 返回 `200`、配置 `<a download>` 或文件支持 Range，均不能替代真实浏览器下载验收。

**请下载服务维护方为安装包路径补齐响应头（不要全站覆盖）：**

```http
Content-Type: application/octet-stream
Content-Disposition: attachment
X-Content-Type-Options: nosniff
```

- 覆盖 `/sep-client/beta/0.1.0/` 下的 `.dmg` 与 `.exe`，后续发行路径也应应用同一规则。
- `Content-Disposition` 可进一步带上对应安装包的 `filename`；不指定时使用 URL 中的文件名。
- 保留现有 HTTPS、Range、Content-Length 与文件内容，不修改安装包或校验和；`SHA256SUMS.txt` 保持文本响应。
- 不用前端全量 `fetch` → Blob 的方式绕过此问题，不新增代理或中转页。

### 8.3 修复后的验收要求

1. 对三个地址重新检查 GET/HEAD 响应头，确认安装包响应包含附件下载声明。
2. 从官网悬浮菜单逐一点击，确认浏览器触发下载、文件名正确、官网不跳转成乱码页。
3. 完整下载三个文件，对照第 3 节清单校验 SHA-256；继续确认 Range 请求返回 `206`。
4. 通过后才标记“三平台浏览器下载验收完成”。这不等同于三平台安装、运行、签名或公证验收。

本轮未修改远程 Caddy 配置，未提交 Git、未 push、未部署。当前 beta 未签名的限制仍按第 6 节执行。


## 9. 下载响应头修复后复验（2026-09-21，通过）

**第 8 节中的 Mac 下载阻塞已解除。** 下载服务维护方反馈已在 `/opt/longdao/deploy/production/conf.d/download.caddy` 中为 `.dmg` / `.exe` 添加附件响应头并热加载。本轮 Web 侧没有修改远程配置，而是从公网和真实浏览器独立复核修复结果。

### 9.1 浏览器与完整文件复核

验证入口：当前工作区的本地官网 `http://localhost:3000/`，新建 Chromium 会话重新加载页面，悬浮“下载客户端 v0.1.0”，逐个点击三个下载项。安装包从公网下载域名直接下载，无请求 mock、前端 Blob 中转或后端代理。

| 平台 | 浏览器点击结果 | 完整文件大小（字节） | SHA-256 |
| --- | --- | ---: | --- |
| macOS Apple 芯片 | 触发下载并完成，官网未跳转 | 130274502 | `97f26a9a066d3a9b550755395fe2667e97fd51d30fc5c87f386332fa08d4e937` |
| macOS Intel | 触发下载并完成，官网未跳转 | 134895169 | `8a623e8e6006bf6c80ed2ea093818ef6d2164a84025ba85fccf141848487a40c` |
| Windows x64 | 触发下载并完成，官网未跳转 | 102700184 | `1047ba679b02bd3264c8a7fdaa689f5d50a9035a9bd57216d8d47dfca515addb` |

三个下载项的实际下载 URL、浏览器下载文件名均与 Web 配置一致；三个完整文件的 SHA-256 均匹配重新获取的公网 `SHA256SUMS.txt` 及第 3 节交付清单。两个 Mac 下载项不再导航成乱码页。

### 9.2 公网响应复核

- 三个安装包 HEAD 均为 `200`，包含 `Content-Type: application/octet-stream` 和 `Content-Disposition: attachment`。
- 三个安装包的 `Range: bytes=0-63` GET 均为 `206`，返回 64 字节，且仍包含上述下载响应头。
- `SHA256SUMS.txt` GET 为 `200`、`text/plain; charset=utf-8`，无附件响应头。
- `RELEASE-NOTES-beta.md` GET 为 `200`、`text/markdown; charset=utf-8`，无附件响应头。
- 获取文本清单时出现一次连接超时，重试成功；最终完整文件下载与校验均通过。

### 9.3 证据与边界

- 下载文件、HTTP 响应头与浏览器执行日志：`/tmp/sep-download-recheck-20260921/`（本地临时证据，不入 Git）。
- 菜单截图：`output/playwright/client-download-recheck-20260921.png`（本地验证产物）。
- 本轮仅更新本交付文档，未修改 Web/客户端源码；未提交 Git、未 push、未部署 Web。
- 本次结论为 **三个平台安装包的 Chromium 浏览器下载验收通过**，不代表已在三种操作系统上完成安装、启动、登录或业务验收；Safari / Firefox 未单独复验。
- 未签名、公证及集成环境 beta 构建限制仍然有效，见第 6 节。生产官网发布后仍应在实际域名上抽查三个下载入口。

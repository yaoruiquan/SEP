# SEP 官网客户端下载接入开发计划 v1

> 文档状态：Web 首版已实现，等待发行包公网地址接入
>
> 更新时间：2026-09-20
>
> 适用仓库：`/Users/yao/LLM/SEP`
>
> 关联客户端仓库：`/Users/yao/LLM/sep-client`

## 1. 最终方案

官网落地页不新增下载详情页，只在 Hero 区「浏览硅基人才市场」按钮旁放置一个「下载客户端」按钮。

用户鼠标悬浮按钮（移动端点击按钮）后，展开一个轻量下载菜单，菜单只包含三个安装包：

| 展示项 | 平台标识 | 目标安装包 |
| --- | --- | --- |
| macOS · Apple 芯片（M1/M2/M3/M4） | `macos-arm64` | `SEP-Client-0.1.0-mac-arm64.dmg` |
| macOS · Intel 芯片 | `macos-x64` | `SEP-Client-0.1.0-mac-x64.dmg` |
| Windows · 64 位 | `windows-x64` | `SEP-Client-0.1.0-win-x64.exe` |

最终用户链路：

```text
官网 Hero
  → 悬浮/点击「下载客户端」
  → 选择三个平台之一
  → 浏览器直接下载对应 OSS/CDN 安装包
```

本方案明确不新增以下内容：

- 不新增 `/download` 或 `/client-download` 页面；
- 不增加 Linux 版本；
- 不增加 beta/stable 渠道切换；
- 不增加顶部导航、页脚重复入口；
- 不增加下载说明、版本详情、更新日志页面；
- 不让 Web 服务代理大体积安装包。

## 2. 当前实现情况

### 2.1 Web 代码

已实现文件：

```text
web/src/app/(marketing)/_components/hero.tsx
web/src/app/(marketing)/_components/hero-download-menu.tsx
web/src/config/client-releases.ts
```

实现行为：

- Hero 两个 CTA 并排展示；
- 「下载客户端」菜单通过鼠标悬浮打开；
- 菜单容器包含按钮与弹层，鼠标从按钮移动到菜单不会闪退；
- 鼠标离开整个菜单区域后关闭；
- 键盘 `Escape` 可关闭；
- 支持键盘焦点进入菜单；
- 移动端点击按钮打开/关闭；
- 菜单使用绝对定位，不撑开 Hero 高度，不遮住下方内容；
- 菜单只有三个平台项；
- 未配置公网地址时显示「准备中」，不会跳转到其他页面；
- 配置 `url` 后，点击平台项直接触发浏览器下载。

`Hero` 中的入口：

```tsx
<div className="flex flex-wrap items-start gap-3">
  <Link href="/marketplace">浏览硅基人才市场</Link>
  <HeroDownloadMenu />
</div>
```

### 2.2 发行配置

统一配置文件：

```text
web/src/config/client-releases.ts
```

当前版本：

```text
0.1.0
```

当前配置结构：

```ts
export type ClientPlatform =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64';

export interface ClientArtifact {
  platform: ClientPlatform;
  label: string;
  fileName: string;
  url: string | null;
  architecture: string;
  minimumOsVersion: string;
}
```

发行包尚未接入公网地址前，三个 `url` 暂为 `null`。拿到 OSS/CDN 地址后，只修改该配置文件中的三个 `url`，不需要新增页面或后端下载接口。

示例：

```ts
url: 'https://download.example.com/client/0.1.0/SEP-Client-0.1.0-mac-arm64.dmg'
```

### 2.3 `/download` 路由

`web/src/app/(marketing)/download/` 已删除，官网不再提供下载详情页。

如果 `.next/types` 中仍然出现旧的 `/download` 类型引用，那是删除页面后留下的构建生成物，不是源码路由。清理 `.next` 后重新执行类型检查/构建即可。

## 3. 客户端发行包现状

客户端仓库：

```text
/Users/yao/LLM/sep-client
```

当前本机 `dist/` 已生成三个目标安装包：

```text
dist/SEP-Client-0.1.0-mac-arm64.dmg
dist/SEP-Client-0.1.0-mac-x64.dmg
dist/SEP-Client-0.1.0-win-x64.exe
```

同时存在自动更新元数据、blockmap 和校验文件。Web 仓库不应复制这些安装包，也不应将它们放到 `web/public`、数据库或 Next.js 镜像中。

### 3.1 当前阻塞点

本机安装包路径不能直接作为浏览器下载地址：

```text
/Users/yao/LLM/sep-client/dist/...
```

浏览器访问官网时无法读取开发者电脑本地文件，因此还需要完成一次发行包上传：

```text
客户端构建产物
  → OSS / 对象存储
  → CDN（可选）
  → HTTPS 公网地址
  → web/src/config/client-releases.ts
```

这一步完成前，菜单可以正常展示和联调布局，但三个条目不会真正开始下载，会显示「准备中」。

## 4. 公网文件发布要求

### 4.1 建议目录

```text
client/0.1.0/SEP-Client-0.1.0-mac-arm64.dmg
client/0.1.0/SEP-Client-0.1.0-mac-x64.dmg
client/0.1.0/SEP-Client-0.1.0-win-x64.exe
```

建议使用独立下载域名，例如：

```text
download.<业务域名>
```

### 4.2 必须满足的条件

- 地址使用 HTTPS；
- 文件名与客户端 `dist/` 中的实际文件一致；
- macOS Apple Silicon、macOS Intel、Windows x64 一一对应，不能串包；
- 文件允许匿名公开读取；
- `Content-Type` 设置正确；
- `Content-Disposition` 建议设置为 `attachment; filename="实际文件名"`；
- OSS/CDN 支持大文件断点续传更佳；
- 上传完成后记录 SHA-256，便于发布核验；
- 下载域名配置跨域策略（如需依赖浏览器 `download` 属性时）。

浏览器对跨域 `<a download>` 的行为可能受响应头影响，因此实际以 OSS/CDN 的 `Content-Disposition: attachment` 为准。Web 不需要自行转发文件流。

### 4.3 地址接入步骤

拿到三个公网地址后，修改：

```text
web/src/config/client-releases.ts
```

示例：

```ts
export const CLIENT_RELEASE: ClientRelease = {
  version: '0.1.0',
  artifacts: [
    {
      platform: 'macos-arm64',
      fileName: 'SEP-Client-0.1.0-mac-arm64.dmg',
      url: 'https://download.example.com/client/0.1.0/SEP-Client-0.1.0-mac-arm64.dmg',
      // ...
    },
    {
      platform: 'macos-x64',
      fileName: 'SEP-Client-0.1.0-mac-x64.dmg',
      url: 'https://download.example.com/client/0.1.0/SEP-Client-0.1.0-mac-x64.dmg',
      // ...
    },
    {
      platform: 'windows-x64',
      fileName: 'SEP-Client-0.1.0-win-x64.exe',
      url: 'https://download.example.com/client/0.1.0/SEP-Client-0.1.0-win-x64.exe',
      // ...
    },
  ],
};
```

## 5. 客户端侧发布检查

### 5.1 安装包检查

客户端发布前确认：

- macOS Apple Silicon 安装包可在 M 系列 Mac 安装启动；
- macOS Intel 安装包可在 Intel Mac 安装启动；
- Windows x64 安装包可在 64 位 Windows 安装启动；
- 安装后应用名称、图标和版本号正确；
- 客户端默认联调环境地址正确；
- 客户端登录、订阅列表、运行时清单和任务上报链路可用；
- 发行包不包含开发机私密配置；
- 如面向外部用户发布，macOS/Windows 签名与安全提示另行处理。

### 5.2 校验和记录

客户端仓库已生成：

```text
/Users/yao/LLM/sep-client/dist/SHA256SUMS.txt
```

每次替换版本时，重新生成校验和并归档。当前官网极简菜单不展示 SHA-256；校验和用于发布验收、故障排查和客户端开发者核对。

## 6. Web 验收标准

### 6.1 视觉与交互

- [x] Hero 仅新增一个「下载客户端」按钮；
- [x] 按钮与「浏览硅基人才市场」并排；
- [x] 桌面端鼠标悬浮按钮显示菜单；
- [x] 鼠标从按钮移动到菜单时菜单保持打开；
- [x] 鼠标移出菜单区域后菜单关闭；
- [x] 点击按钮可以打开/关闭菜单；
- [x] `Escape` 可以关闭菜单；
- [x] 移动端不依赖 hover，点击可以操作；
- [x] 菜单不会撑开 Hero 或遮住后续内容；
- [x] 菜单只显示三个平台版本；
- [x] 不出现 Linux、beta、查看详情、下载详情页等内容；
- [ ] 三个平台填入真实 `url` 后，逐项点击可直接下载正确文件。

### 6.2 路由与构建

- [x] 源码中不存在营销下载页目录；
- [ ] `pnpm --dir web exec tsc --noEmit --incremental false` 通过；
- [ ] `pnpm --dir web build` 通过；
- [ ] `git diff --check` 通过；
- [ ] 浏览器验证首页无 `/download` 跳转；
- [ ] 浏览器验证三个下载链接的最终文件名和 HTTP 响应头正确。

## 7. 推荐验证命令

```bash
# 清理 Next 生成类型后检查
rm -rf web/.next
pnpm --dir web exec tsc --noEmit --incremental false

# 生产构建
pnpm --dir web build

# 空白检查
git diff --check
```

如只做菜单 UI 调整，不需要运行后端全量测试；如修改客户端登录或监控接口，再按后端模块测试规则补充验证。

## 8. 后续待办清单

### Web

- [ ] 获取三个安装包的 OSS/CDN HTTPS 地址；
- [ ] 将三个 `url` 写入 `web/src/config/client-releases.ts`；
- [ ] 对三个地址执行 HEAD/GET 验证；
- [ ] 在真实浏览器中确认点击后直接下载；
- [ ] 确认下载失败时浏览器不会跳到不存在的页面。

### 客户端/发布

- [ ] 确认 macOS ARM64、macOS x64、Windows x64 三包版本号一致；
- [ ] 确认三包分别在目标系统完成安装冒烟测试；
- [ ] 确认客户端联调环境地址与官网发布说明一致；
- [ ] 配置安装包签名、证书和后续自动更新策略；
- [ ] 规划正式版本的发布目录和版本保留策略。

## 9. 设计决策记录

### 为什么不新增下载页

当前需求是官网落地页提供一个快速下载入口，而不是建设完整的发行中心。下载详情页会增加一次跳转和维护成本，也会让首屏出现过多产品信息。当前三个固定安装包用悬浮菜单即可完成目标。

### 为什么不由后端代理安装包

安装包体积大且下载频率不可控。让 OSS/CDN 承载静态文件更利于缓存、断点续传和扩展，也避免占用 NestJS API 服务资源。

### 为什么仍保留独立的发行配置文件

三个安装包后续会随版本更新。把版本、文件名、架构和 URL 集中在 `client-releases.ts`，可以避免把下载地址散落在 JSX 中，也不需要为一个简单下载菜单额外建设后端版本接口。

# SEP Skill Scanner / CLI

能力贡献中心的 Skill 来源现在收敛为**本地自动扫描 + CLI/本地桥接导入**。浏览器不会再通过目录选择器读取磁盘；扫描和打包都在用户自己的设备上完成，只有用户明确选择并发布时才会把包上传到平台。

## 命令

```bash
# 自动发现当前项目沿途和用户级 Agent Skills 目录
node scripts/skill-scanner/sep-skill.mjs scan

# 只扫描某个范围或 Agent
node scripts/skill-scanner/sep-skill.mjs scan --scope user --agent claude,codex
node scripts/skill-scanner/sep-skill.mjs list --scope project

# 在本机打包指定 Skill 目录（不会执行包内脚本）
node scripts/skill-scanner/sep-skill.mjs package ~/.claude/skills/my-skill --output /tmp/my-skill.zip

# CLI 直接投稿：Token 只从环境变量读取，不写入命令行参数、文件或日志
SEP_ACCESS_TOKEN=... SEP_API_BASE_URL=https://your-sep-host node scripts/skill-scanner/sep-skill.mjs publish ~/.claude/skills/my-skill

# 启动给 SEP 网页调用的本地桥接，仅监听 127.0.0.1
node scripts/skill-scanner/sep-skill.mjs serve --port 3210
```

`serve` 提供：

- `GET /health`
- `GET /scan?scope=all&agent=claude,codex`
- `GET /package?id=<scan-item-id>`：只打包扫描结果中的明确选择项

本地桥接不执行 Skill 内容、不持久化 Access Token、不扫描用户未配置的磁盘范围，也不接受网页传入任意本地路径。默认只允许 `localhost:3000` / `127.0.0.1:3000` 跨域调用，可用 `SEP_SKILL_ALLOWED_ORIGINS` 配置。网页接入时应显示扫描范围，并要求逐项确认。

## 扫描范围

首批目录基于 Agent Skills 的公开目录约定和开源 `skills` CLI 的 project/global scope 思路：

- 用户级：`~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills`、`~/.gemini/skills`、`~/.config/opencode/skills`
- 项目级：当前目录到仓库根沿途的 `.agents/skills`、`.claude/skills`、`.gemini/skills`、`.opencode/skills`、标准 `skills/`

每项需要包含 `SKILL.md`。扫描输出包含来源 Agent、作用域、路径、frontmatter 名称/描述、文件清单、大小和确定性 SHA-256。跳过符号链接，并拒绝逃逸扫描根目录的真实路径。

## 安全边界

- 不执行 Skill 包内的 shell、Node、Python 或其他脚本。
- 平台服务端不执行 `npm install`、`npx`、`git` 或用户上传内容。
- 上传后服务端仍会重新解包、计算哈希和静态校验。
- 外部 npm/registry 来源应先在用户本机安装到受支持的 Agent Skills 目录，再由扫描器选择导入；本轮不在服务端运行包管理器。

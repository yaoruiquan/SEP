# 本地 Skill 扫描器

这是一个本地 Skill 扫描与上传工具，供 SEP Client/CLI 调用。它不会执行 Skill 包内脚本，也不会运行 npm/npx。只有用户明确指定目录并执行上传命令时才会上传。

```bash
node scripts/skill-scanner/scanner.mjs
node --test scripts/skill-scanner/scanner.test.mjs
```

默认扫描项目级和用户级目录：`.agents/skills`、`.claude/skills`、`.codex/skills`、`.gemini/skills`、`.opencode/skills`，以及用户目录下的 OpenCode 配置目录。每项必须是包含 `SKILL.md` 的一级子目录；扫描输出包含来源、作用域、路径、frontmatter 的 `name/description`、确定性 SHA-256、文件清单和大小。

扫描器跳过符号链接，并对每个真实路径做根目录边界校验，避免通过 symlink 逃逸。上传仍须由用户在平台界面或 CLI 中明确选择并执行。

## CLI 上传闭环

```bash
# 只扫描本机候选，不上传
node scripts/skill-scanner/upload.mjs --list

# 上传用户明确指定的 Skill 目录
SEP_ACCESS_TOKEN=... \
node scripts/skill-scanner/upload.mjs \
  --path ~/.codex/skills/my-skill \
  --base-url http://localhost:3001/api

# 上传后同时创建能力贡献草稿
SEP_ACCESS_TOKEN=... \
node scripts/skill-scanner/upload.mjs \
  --path ~/.codex/skills/my-skill \
  --create \
  --description '用于生成周报并输出可执行结论'
```

`--path` 必须指向直接包含 `SKILL.md` 的目录。CLI 会生成无压缩 UTF-8 ZIP，调用 `POST /contributions/skill-package`，然后在 `--create` 时只把服务端返回的 `sha256` 发给 `POST /contributions`；不会把正文作为可信数据重复提交。API 根地址也可通过 `SEP_API_URL` 配置，访问令牌通过 `SEP_ACCESS_TOKEN` 配置。

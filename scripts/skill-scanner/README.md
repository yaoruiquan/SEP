# 本地 Skill 扫描器

这是一个只读的本地清单扫描原型，供 SEP Client/CLI 调用。它不会执行 Skill 包内脚本，也不会自动上传。

```bash
node scripts/skill-scanner/scanner.mjs
node --test scripts/skill-scanner/scanner.test.mjs
```

默认扫描项目级和用户级目录：`.agents/skills`、`.claude/skills`、`.codex/skills`、`.gemini/skills`、`.opencode/skills`，以及用户目录下的 OpenCode 配置目录。每项必须是包含 `SKILL.md` 的一级子目录；扫描输出包含来源、作用域、路径、frontmatter 的 `name/description`、确定性 SHA-256、文件清单和大小。

扫描器跳过符号链接，并对每个真实路径做根目录边界校验，避免通过 symlink 逃逸。上传仍须由用户在平台界面明确选择并执行。

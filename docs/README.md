# 硅基人才平台 - 文档导航

> 最后更新：2026-07-24

## 📚 目录结构

### 📐 架构与设计
- [需求与架构规格书 v2](./architecture/硅基人才平台-需求与架构规格书-v2.md) - 完整的产品需求和系统架构
- [技术选型决策文档](./architecture/技术选型决策文档.md) - 技术栈选择理由与对比
- [前端设计文档 v1](./architecture/前端设计文档-v1.md) - UI/UX 设计规范与组件库
- [模块开发顺序指南](./architecture/模块开发顺序指南.md) - 分层开发策略
- [ADR 目录](./architecture/adr/) - 架构决策记录（Architecture Decision Records）

### 📋 实施计划
- [AI 集成实施计划](./plans/AI-Integration-Implementation-Plan.md) - sub2api + Coze 集成开发计划（8 阶段，18-24h）

### 🔬 技术调研
- [Agent Runtime 框架评估](./research/agent-runtime-framework-evaluation.md) - Vercel AI SDK vs LangChain 对比

### 🔌 外部集成
- [OpenCode 执行后端接口契约](./对接/OpenCode执行后端-协作与接口契约.md) - OpenCode Skills Service HTTP API 规范
- [Agent Runtime 对比](./对接/agent-runtime-对比.md) - 不同 Agent 框架对比分析

### 📅 开发进度
- [2026-07-23 开发记录](./progress/2026-07-23.md) - Layer 5 对话系统 + 前端核心页面
- [2026-07-24 E2E 修复记录](./progress/2026-07-24-e2e-fixes.md) - 5 个阻断级问题修复
- [Layer 0 完成报告](./progress/layer-0-completion-report.md) - 基础设施搭建完成

> **说明**: `progress/` 目录记录每日开发进度，按日期归档

### 🧪 测试
- **指南**: [E2E 测试指南](./test/guides/E2E-TEST-GUIDE.md) - 浏览器端到端测试执行手册
- **计划**: [测试计划目录](./test/plans/) - 测试范围与用例设计
- **报告**: [测试报告目录](./test/reports/) - 历史测试结果与问题追踪
- **修复**: [修复记录目录](./test/fix/) - 测试发现问题的修复记录

### 📊 项目状态
- [**开发状态总览**](./status/development-status.md) ⭐ - 当前进度、模块状态、下一步计划（**每次提交更新**）
- [里程碑记录](./status/milestones/) - Layer 验收与重要节点

---

## 🚀 快速开始

### 新成员入门
1. **了解项目** → 阅读 [需求与架构规格书](./architecture/硅基人才平台-需求与架构规格书-v2.md)
2. **查看进度** → 阅读 [开发状态总览](./status/development-status.md)
3. **开始开发** → 阅读 [模块开发顺序指南](./architecture/模块开发顺序指南.md)
4. **运行测试** → 阅读 [E2E 测试指南](./test/guides/E2E-TEST-GUIDE.md)

### 日常开发流程
1. 查看 [开发状态](./status/development-status.md) 确认当前任务
2. 实施功能（参考 [实施计划](./plans/)）
3. 运行测试（参考 [测试指南](./test/guides/)）
4. 提交代码并**更新** [开发状态](./status/development-status.md)
5. 记录今日进度到 `progress/YYYY-MM-DD.md`

---

## 📝 文档维护规范

### 每次提交必须更新
- `status/development-status.md` - 更新模块状态、最新提交信息、当前进度

### 每日开发记录
- `progress/YYYY-MM-DD.md` - 记录当天完成的功能、遇到的问题、解决方案

### 按需创建
- `progress/功能名-completion-report.md` - 重要功能完成报告（如 layer-0-completion-report.md）
- `test/reports/YYYY-MM-DD-测试类型-report.md` - 测试报告
- `test/fix/YYYY-MM-DD-问题描述.md` - 测试发现问题的修复记录
- `plans/功能名-Implementation-Plan.md` - 大型功能的实施计划

### 目录职责
- `architecture/` - 长期稳定的架构文档，不频繁修改
- `plans/` - 未来要做的计划，完成后归档到 `progress/`
- `progress/` - 每日开发进度记录，**高频更新**
- `status/` - 项目总体状态，**每次提交更新**
- `test/` - 测试相关，按类型分 guides/plans/reports/fix
- `research/` - 技术调研，一次性文档

---

## 🔗 外部链接

- [GitHub 仓库](https://github.com/your-org/SEP)
- [部署文档](../README.md)
- [API 文档](http://localhost:3001/api/docs) - 本地开发时访问 Swagger

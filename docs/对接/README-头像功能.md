# 头像功能对接文档导航

> **更新时间**: 2026-09-18  
> **状态**: ✅ 已实现，待部署到联调环境

## 📚 文档列表

### 1. [客户端头像对接指南](./客户端头像对接指南-v1.md)
**适用对象**: Electron 客户端开发者  
**内容**: 
- 数据结构和接口位置
- 显示规则和回退策略
- 缓存与刷新机制
- 常见错误和解决方案
- 完整示例代码

👉 **客户端开发者请优先阅读此文档**

### 2. [员工头像共享协议](./员工头像共享协议.md)
**适用对象**: 后端开发者、系统架构师  
**内容**:
- 完整技术规范
- 数据源与接口定义
- 同步与缓存策略
- 部署配置要求
- 素材管理流程

### 3. [头像功能部署清单](./头像功能部署清单.md)
**适用对象**: 运维人员、部署负责人  
**内容**:
- 部署前检查清单
- 详细部署步骤
- 验收测试方案
- 故障排查指南
- 回滚方案

## 🎯 快速开始

### 客户端开发者

1. **理解数据结构**
   ```typescript
   interface EmployeeAvatarAsset {
     id: string;              // "silicon:frontend-engineer"
     version: string | null;  // "abc123..." 或 null
     portraitUrl: string;     // 完整人物图（大图）
     faceUrl: string;         // 头肩图（小图）
   }
   ```

2. **选择合适的图片**
   - 列表/聊天 → 使用 `faceUrl`（小图）
   - 详情页 → 使用 `portraitUrl`（大图）

3. **处理回退**
   - 加载失败 → 尝试另一个 URL
   - 都失败 → 显示姓名首字占位符

4. **正确缓存**
   - 使用完整 URL（含 `?v=版本号`）作为缓存键
   - 版本变化会自动触发重新下载

### 后端部署人员

1. **环境变量配置**
   ```bash
   # 联调环境
   ASSET_BASE_URL=https://sep-dev.longdaoSEP.cn
   
   # 生产环境
   ASSET_BASE_URL=https://longdaoSEP.cn
   ```

2. **部署命令**
   ```bash
   cd /opt/sep-dev
   docker-compose -f docker-compose.dev.yml up -d
   ```

3. **验证部署**
   ```bash
   # 检查静态资源
   curl -I https://sep-dev.longdaoSEP.cn/assets/employees/silicon/frontend-engineer.webp
   
   # 检查 API 返回
   curl -H "Authorization: Bearer $TOKEN" \
     https://sep-dev.longdaoSEP.cn/api/client/subscriptions
   ```

## 📋 当前状态

| 项目 | 状态 | 说明 |
|------|------|------|
| 后端代码 | ✅ 已完成 | commit 92a17db |
| 前端代码 | ✅ 已完成 | Web 端已实现并测试 |
| 素材文件 | ✅ 已就位 | 192 个 .webp 文件 |
| 素材清单 | ✅ 已生成 | employee-avatar-assets.json |
| 单元测试 | ✅ 已通过 | 107 backend + 59 frontend |
| 联调环境部署 | ⏳ 待部署 | 需要运维执行 |
| 客户端集成 | ⏳ 待开始 | 等待联调环境部署 |

## 🔗 相关接口

所有返回员工信息的接口都包含 `avatarAsset` 字段：

| 接口 | 字段路径 |
|------|---------|
| `GET /client/subscriptions` | `template.avatarAsset` |
| `GET /client/subscriptions/:id/runtime` | `employee.avatarAsset` |
| `GET /enterprise/my-employees` | `employee.avatarAsset` |
| `GET /subscriptions/:id` | `employee.avatarAsset` |
| `GET /conversations/:id` | `employee.avatarAsset` |

## 🎨 设计原则

1. **统一身份** - 同一员工在所有客户端显示相同形象
2. **按需加载** - API 返回完整 URL，无需拼接
3. **版本控制** - URL 参数控制缓存刷新
4. **优雅降级** - 兼容旧服务器和加载失败

## 🚀 部署流程

```
代码合并 → 更新服务器代码 → 构建镜像 → 配置环境变量 
  → 部署服务 → 健康检查 → 通知客户端团队
```

## ❓ 常见问题

### Q1: 客户端如何判断使用哪张图？

**A**: 根据显示尺寸选择：
- 小于 64px → `faceUrl`（头肩图）
- 大于 64px → `portraitUrl`（完整人物图）

### Q2: 图片加载失败怎么办？

**A**: 按顺序回退：
1. 尝试 `faceUrl`
2. 失败则尝试 `portraitUrl`
3. 都失败则显示姓名首字

### Q3: 如何处理图片缓存？

**A**: 使用完整 URL（含 `?v=版本号`）作为缓存键，版本号变化会自动触发重新下载。

### Q4: 本地开发时图片无法加载？

**A**: 检查 `ASSET_BASE_URL` 是否配置为客户端可访问的地址（不能是 localhost）。

### Q5: 旧服务器没有 avatarAsset 怎么办？

**A**: 回退到 `avatar` 字段，客户端需要同时处理两种情况。

## 📞 联系方式

遇到问题请联系：

- **后端支持**: SEP 后端团队
- **部署支持**: 运维团队
- **文档问题**: 提交 Issue 或 PR

## 📝 更新日志

- **2026-09-18**: 创建对接文档套件
- **2026-09-16**: 头像功能代码合并到 main
- **2026-09-16**: 完成单元测试和集成测试

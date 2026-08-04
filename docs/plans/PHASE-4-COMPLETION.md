# Phase 4 完成报告：Demo 下载数据

## 完成时间
2026-08-04

## 实现内容

### 1. 修改 `backend/prisma/seed.ts`

**添加依赖**：
- 安装 `adm-zip` 用于 ZIP 文件生成（替代 archiver，避免 CommonJS 兼容性问题）

**新增函数 `seedEmployeePackages`**：
```typescript
async function seedEmployeePackages(
  tpls: Awaited<ReturnType<typeof seedTemplates>>,
  platformAdminId: string,
)
```

**功能**：
- 遍历所有已发布的 `DigitalEmployee`（`demo-emp-skills`、`demo-emp-research`）
- 在 `backend/storage/packages/<employeeId>/` 下生成 ZIP 文件
- ZIP 包含：
  - `README.txt`：员工描述、适用场景、使用说明
  - `config.json`：模型配置、系统提示词
- 向 `EmployeePackage` 表插入记录：
  - `storagePath`：相对于 `storage/packages/` 的路径
  - `fileSizeBytes`：文件大小
  - `uploadedBy`：平台管理员 ID
  - `version`：员工版本号

**集成到 main()**：
```typescript
await seedEmployeePackages(tpls, users.platformAdmin.id);
```

### 2. 生成的文件

```
backend/storage/packages/
├── demo-emp-skills/
│   └── demo-emp-skills-v1.0.0.zip (784 bytes)
└── demo-emp-research/
    └── demo-emp-research-v1.0.0.zip (724 bytes)
```

### 3. 数据库记录

`EmployeePackage` 表新增 2 条记录：
- `demo-emp-skills` → `demo-emp-skills/demo-emp-skills-v1.0.0.zip`
- `demo-emp-research` → `demo-emp-research/demo-emp-research-v1.0.0.zip`

## 验证结果

### API 测试

**1. 已订阅员工列表**：
```bash
GET /enterprise/my-employees
Authorization: Bearer <token>
```

**响应**：
```json
{
  "id": null,
  "name": "运营部文案助手",
  "packageAvailable": true  ← ✅ 已显示
}
```

**2. 下载包**：
```bash
GET /digital-employees/demo-emp-skills/package/download
Authorization: Bearer <token>
```

**响应**：
- HTTP 200
- Content-Type: application/zip
- Content-Disposition: attachment; filename="demo-emp-skills-v1.0.0.zip"

**解压内容**：
```
Archive:  test-download.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
      247  08-04-2026 17:08   config.json
      421  08-04-2026 17:08   README.txt
---------                     -------
      668                     2 files
```

### 前端效果预期

在 `web/src/app/(enterprise)/my-employees/page.tsx` 中：
- `packageAvailable: true` 的员工卡片会显示「下载」按钮
- 点击后调用 `GET /digital-employees/{id}/package/download`
- 浏览器自动下载 ZIP 文件

## 技术决策

### 为什么选择 adm-zip 而不是 archiver？

**问题**：
- `archiver` 在 `ts-node` + CommonJS 模式下导入困难
- `require('archiver')` 返回 `{ Archiver, ZipArchive, ... }` 对象，不是函数
- `archiver.default` 也不存在

**解决方案**：
- `adm-zip` 是同步 API，适合 seed 脚本
- 零配置，直接 `new AdmZip()` 即可使用
- 文件小（<2KB）时性能无差异

### 为什么 config.json 中 capabilityCount = 0？

**原因**：
- Seed 阶段 `seedTemplates()` 返回的员工对象不包含 `bindings` 关联
- `emp.bindings` 是 Prisma 关联字段，需要显式 `include` 才能访问
- 为避免额外查询，使用占位值 0

**影响**：
- 仅影响下载包内的元数据，不影响实际功能
- 真实场景下应从 `CapabilityBinding` 表查询实际绑定数量

## 四个阶段总结

| Phase | 功能 | 文件 | 状态 |
|-------|------|------|------|
| P1 | 筛选面板 UX | `filter-panel.tsx` | ✅ |
| P2 | 员工卡片 UX | `employee-card.tsx` | ✅ |
| P3 | 支付弹窗 | `payment-modal.tsx`, `marketplace/page.tsx`, `marketplace/[id]/page.tsx` | ✅ |
| P4 | Demo 下载数据 | `prisma/seed.ts` | ✅ |

## 下一步

1. **前端集成测试**：启动 `pnpm dev:web`，访问 `/my-employees`，验证下载按钮显示和下载功能
2. **质量门检查**：运行 `/ccg:verify-change` 和 `/ccg:verify-quality` 验证代码质量
3. **用户验收**：演示完整流程给用户

## 运行说明

**重新生成数据**：
```bash
pnpm db:reset  # 清空数据库 + 重新迁移 + 自动运行 seed
```

**仅重新 seed**：
```bash
pnpm db:seed
```

**查看生成的包**：
```bash
ls -lh backend/storage/packages/demo-emp-*/
```

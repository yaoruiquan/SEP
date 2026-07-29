-- ZIP 字段改为可空（为 packageRef-only 路径让路），同时加 packageRef 列。
-- ZIP 与 packageRef 可以并存，也可以各自单独存在：
--   - 只有 ZIP：现有数据，无 npm 包时的兜底通道
--   - 只有 packageRef：客户端直接用 pi install，平台不存文件
--   - 两者都有：同一版本在 npm 和 ZIP 都可用

ALTER TABLE "employee_packages"
  ALTER COLUMN "filename"      DROP NOT NULL,
  ALTER COLUMN "storagePath"   DROP NOT NULL,
  ALTER COLUMN "sha256"        DROP NOT NULL,
  ALTER COLUMN "fileSizeBytes" DROP NOT NULL,
  ADD COLUMN "packageRef" JSONB;

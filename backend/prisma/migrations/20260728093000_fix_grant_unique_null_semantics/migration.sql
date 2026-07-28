-- 修复 employee_grants 的唯一约束在 NULL 语义下永不生效的问题
--
-- 原约束：UNIQUE (instanceId, departmentId, memberId)
-- 授权对象二选一 —— 给部门则 memberId 为 NULL，给成员则 departmentId 为 NULL，
-- 三列必有一列是 NULL。Postgres 唯一索引视 NULL 互不相等，故两条完全相同的
-- 授权不冲突，约束形同虚设。
--
-- 实测后果：重复开通授权返回 201 而非 409（E2E 已捕获），脏数据堆积；
-- GrantService.create 里 catch P2002 → 409 那段成为死代码；
-- 收回授权时只删一条，用户侧表现为「收回无效」。
--
-- 改为两个**部分唯一索引**，各自只在对应列非 NULL 时生效。
-- Prisma schema 无法表达 WHERE 子句，故手写此迁移；schema.prisma 中
-- 对应的 @@unique 已移除并留注释指向这里。

-- ① 先去重：每组重复只保留 createdAt 最早的一条。
--    必须在建唯一索引之前执行，否则建索引会失败。
DELETE FROM "employee_grants"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "instanceId", "departmentId", "memberId"
             ORDER BY "createdAt" ASC, "id" ASC
           ) AS rn
    FROM "employee_grants"
  ) dup
  WHERE dup.rn > 1
);

-- ② 移除失效的三列复合唯一索引
DROP INDEX IF EXISTS "employee_grants_instanceId_departmentId_memberId_key";

-- ③ 部门授权：同一实例对同一部门只能有一条
CREATE UNIQUE INDEX "employee_grants_instance_department_key"
  ON "employee_grants" ("instanceId", "departmentId")
  WHERE "departmentId" IS NOT NULL;

-- ④ 成员授权：同一实例对同一成员只能有一条
CREATE UNIQUE INDEX "employee_grants_instance_member_key"
  ON "employee_grants" ("instanceId", "memberId")
  WHERE "memberId" IS NOT NULL;

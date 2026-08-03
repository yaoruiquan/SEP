-- 修复枚举漂移：补齐 EmployeeStatus.PENDING
--
-- 背景：迁移 20260730170012 在 _prisma_migrations 里被记为 finished=true 但
-- applied_steps_count=0（手工 resolve --applied），其中的
-- `ALTER TYPE "EmployeeStatus" ADD VALUE 'PENDING'` 从未真正执行。
-- 该迁移原文把 ADD VALUE 和随后使用新值的 UPDATE 放在同一事务里，
-- PostgreSQL 不允许在添加枚举值的同一事务内引用它，因此原始迁移在此失败。
--
-- 本迁移只做 ADD VALUE，不在同事务内使用该值，规避上述限制。
-- 幂等（IF NOT EXISTS），纯增量，不修改任何现有行。

ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'PENDING';

-- 说明：数据库中残留的 'PUBLISHED' 值未被删除。PostgreSQL 无法直接 DROP
-- 枚举值（需重建类型并重写所有引用列），且当前无任何行使用它，
-- schema.prisma 也不再声明它，故保持现状不做破坏性变更。

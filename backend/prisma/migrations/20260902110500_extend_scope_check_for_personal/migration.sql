-- 让作用域约束容纳 PERSONAL
--
-- 原约束（20260820063453）只认两种作用域：
--   PLATFORM   → enterpriseId IS NULL
--   ENTERPRISE → enterpriseId IS NOT NULL
-- 它的用意是「平台版不能挂企业，企业版不能失去租户边界」，这两条依然要守。
--
-- PERSONAL 是第三种：它属于某个成员，同时也必须落在一个企业里 ——
-- 个人副本的可见性是「本企业管理员看得到」，没有 enterpriseId 就无从判定谁能看。
-- 因此 PERSONAL 与 ENTERPRISE 一样要求 enterpriseId NOT NULL，并额外要求 ownerId NOT NULL：
-- 没有 ownerId 的个人副本对谁都不生效，是一条永不会被 resolveEffectiveVersion 命中的死行。
--
-- 反过来也约束住 PLATFORM/ENTERPRISE 不能带 ownerId —— 那会让「这一版属于谁」出现歧义。

ALTER TABLE "skill_versions" DROP CONSTRAINT "skill_versions_scope_enterprise_check";

ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_scope_enterprise_check"
CHECK (
  ("scope" = 'PLATFORM' AND "enterpriseId" IS NULL AND "ownerId" IS NULL)
  OR ("scope" = 'ENTERPRISE' AND "enterpriseId" IS NOT NULL AND "ownerId" IS NULL)
  OR ("scope" = 'PERSONAL' AND "enterpriseId" IS NOT NULL AND "ownerId" IS NOT NULL)
);

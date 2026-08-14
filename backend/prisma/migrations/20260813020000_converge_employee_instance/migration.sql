-- 收敛 EmployeeInstance → Subscription
--
-- 背景：原先「订阅 → 实例 → 授权」三层，中间的实例对象除了当权限锚点外
-- 无实际职责（config 无写入路径、status 与订阅状态语义重叠、name 仅 seed
-- 写过、departmentId 无 UI 入口）。本迁移把授权类外键直接挂到订阅上。
--
-- 顺序：补订阅 → 加列 → 搬数据 → 去重 → 收紧非空 → 建约束 → 删表。
-- 每一步都留下可校验的中间状态，失败时整个事务回滚。

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 0. 孤儿实例：有实例但无对应订阅。按决策丢弃，但先记录明细。
--    这类数据来自早期测试，没有订阅就不该存在雇佣关系。
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT i.id, i.name, i."enterpriseId", i."templateId",
           (SELECT COUNT(*) FROM employee_grants g WHERE g."instanceId" = i.id) AS grants,
           (SELECT COUNT(*) FROM knowledge_grants k WHERE k."instanceId" = i.id) AS kgrants,
           (SELECT COUNT(*) FROM access_requests a WHERE a."instanceId" = i.id) AS reqs
    FROM employee_instances i
    LEFT JOIN subscriptions s
      ON s."enterpriseId" = i."enterpriseId" AND s."employeeId" = i."templateId"
    WHERE s.id IS NULL
  LOOP
    n := n + 1;
    RAISE NOTICE '[orphan] instance=% name=% enterprise=% template=% grants=% kgrants=% requests=% → 丢弃',
      r.id, r.name, r."enterpriseId", r."templateId", r.grants, r.kgrants, r.reqs;
  END LOOP;
  RAISE NOTICE '[orphan] 共 % 条孤儿实例被丢弃', n;
END $$;

DELETE FROM employee_instances i
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s
  WHERE s."enterpriseId" = i."enterpriseId" AND s."employeeId" = i."templateId"
);

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Subscription 新增 templateVersion / name
--    先可空，回填后再收紧为 NOT NULL。
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE subscriptions ADD COLUMN "templateVersion" TEXT;
ALTER TABLE subscriptions ADD COLUMN "name" TEXT;

-- 从主实例（同组内最早创建的那条）回填版本与自定义名称。
-- 名称仅在与模板名不同时才保留 —— 相同的话是自动创建时的复制，
-- 留着反而会把模板改名后的展示钉死在旧名字上。
WITH primary_instance AS (
  SELECT DISTINCT ON (i."enterpriseId", i."templateId")
         i."enterpriseId", i."templateId", i."templateVersion", i.name
  FROM employee_instances i
  ORDER BY i."enterpriseId", i."templateId", i."createdAt" ASC, i.id ASC
)
UPDATE subscriptions s
SET "templateVersion" = p."templateVersion",
    "name" = CASE WHEN p.name IS DISTINCT FROM e.name THEN p.name ELSE NULL END
FROM primary_instance p
JOIN digital_employees e ON e.id = p."templateId"
WHERE s."enterpriseId" = p."enterpriseId" AND s."employeeId" = p."templateId";

-- 没有实例的订阅（订阅接口创建但未建实例的）：用模板当前版本兜底。
UPDATE subscriptions s
SET "templateVersion" = COALESCE(e.version, '1.0.0')
FROM digital_employees e
WHERE e.id = s."employeeId" AND s."templateVersion" IS NULL;

UPDATE subscriptions SET "templateVersion" = '1.0.0' WHERE "templateVersion" IS NULL;
ALTER TABLE subscriptions ALTER COLUMN "templateVersion" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. employee_grants: instanceId → subscriptionId
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE employee_grants ADD COLUMN "subscriptionId" TEXT;

UPDATE employee_grants g
SET "subscriptionId" = s.id
FROM employee_instances i
JOIN subscriptions s
  ON s."enterpriseId" = i."enterpriseId" AND s."employeeId" = i."templateId"
WHERE g."instanceId" = i.id;

-- 合并多实例后可能出现重复（同一订阅 + 同一部门/成员）。
-- 保留最早的一条：授权时间早的那条更可能带着真实的业务意图，
-- 且 expiresAt 若不同，早的一条通常是长期授权。
DELETE FROM employee_grants g
WHERE g.id NOT IN (
  SELECT DISTINCT ON ("subscriptionId", "departmentId") id
  FROM employee_grants
  WHERE "departmentId" IS NOT NULL
  ORDER BY "subscriptionId", "departmentId", "createdAt" ASC, id ASC
) AND g."departmentId" IS NOT NULL;

DELETE FROM employee_grants g
WHERE g.id NOT IN (
  SELECT DISTINCT ON ("subscriptionId", "memberId") id
  FROM employee_grants
  WHERE "memberId" IS NOT NULL
  ORDER BY "subscriptionId", "memberId", "createdAt" ASC, id ASC
) AND g."memberId" IS NOT NULL;

DELETE FROM employee_grants WHERE "subscriptionId" IS NULL;
ALTER TABLE employee_grants ALTER COLUMN "subscriptionId" SET NOT NULL;

DROP INDEX IF EXISTS employee_grants_instance_department_key;
DROP INDEX IF EXISTS employee_grants_instance_member_key;
DROP INDEX IF EXISTS "employee_grants_instanceId_idx";
ALTER TABLE employee_grants DROP CONSTRAINT IF EXISTS "employee_grants_instanceId_fkey";
ALTER TABLE employee_grants DROP COLUMN "instanceId";

ALTER TABLE employee_grants
  ADD CONSTRAINT "employee_grants_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES subscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "employee_grants_subscriptionId_idx" ON employee_grants("subscriptionId");

-- 部分唯一索引：Postgres 视 NULL 互不相等，普通 @@unique 在此失效，
-- 必须带 WHERE 子句。详见 schema 中 EmployeeGrant 的注释。
CREATE UNIQUE INDEX employee_grants_subscription_department_key
  ON employee_grants("subscriptionId", "departmentId") WHERE "departmentId" IS NOT NULL;
CREATE UNIQUE INDEX employee_grants_subscription_member_key
  ON employee_grants("subscriptionId", "memberId") WHERE "memberId" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. knowledge_grants: instanceId → subscriptionId
--    departmentId 保持原样 —— 它从此真正生效（检索时按部门过滤），
--    而非像从前那样是条死路径。
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE knowledge_grants ADD COLUMN "subscriptionId" TEXT;

UPDATE knowledge_grants k
SET "subscriptionId" = s.id
FROM employee_instances i
JOIN subscriptions s
  ON s."enterpriseId" = i."enterpriseId" AND s."employeeId" = i."templateId"
WHERE k."instanceId" = i.id;

-- 同一知识库 + 同一订阅 + 同一部门的重复，保留最早一条
DELETE FROM knowledge_grants k
WHERE k.id NOT IN (
  SELECT DISTINCT ON ("knowledgeBaseId", "subscriptionId", "departmentId") id
  FROM knowledge_grants
  ORDER BY "knowledgeBaseId", "subscriptionId", "departmentId", "createdAt" ASC, id ASC
);

-- 既无订阅也无部门的授权是无主记录，删掉
DELETE FROM knowledge_grants WHERE "subscriptionId" IS NULL AND "departmentId" IS NULL;

DROP INDEX IF EXISTS "knowledge_grants_knowledgeBaseId_instanceId_key";
DROP INDEX IF EXISTS "knowledge_grants_knowledgeBaseId_departmentId_key";
ALTER TABLE knowledge_grants DROP CONSTRAINT IF EXISTS "knowledge_grants_instanceId_fkey";
ALTER TABLE knowledge_grants DROP COLUMN "instanceId";

ALTER TABLE knowledge_grants
  ADD CONSTRAINT "knowledge_grants_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES subscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "knowledge_grants_subscriptionId_idx" ON knowledge_grants("subscriptionId");
CREATE INDEX IF NOT EXISTS "knowledge_grants_departmentId_idx" ON knowledge_grants("departmentId");

CREATE UNIQUE INDEX "knowledge_grants_knowledgeBaseId_subscriptionId_key"
  ON knowledge_grants("knowledgeBaseId", "subscriptionId") WHERE "subscriptionId" IS NOT NULL;
CREATE UNIQUE INDEX "knowledge_grants_knowledgeBaseId_departmentId_key"
  ON knowledge_grants("knowledgeBaseId", "departmentId") WHERE "departmentId" IS NOT NULL;

-- 订阅 + 部门叠加时的唯一性：同一知识库对「某员工在某部门」只授权一次
CREATE UNIQUE INDEX knowledge_grants_kb_subscription_department_key
  ON knowledge_grants("knowledgeBaseId", "subscriptionId", "departmentId")
  WHERE "subscriptionId" IS NOT NULL AND "departmentId" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. access_requests: instanceId → subscriptionId
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE access_requests ADD COLUMN "subscriptionId" TEXT;

UPDATE access_requests a
SET "subscriptionId" = s.id
FROM employee_instances i
JOIN subscriptions s
  ON s."enterpriseId" = i."enterpriseId" AND s."employeeId" = i."templateId"
WHERE a."instanceId" = i.id;

DELETE FROM access_requests WHERE "subscriptionId" IS NULL;
ALTER TABLE access_requests ALTER COLUMN "subscriptionId" SET NOT NULL;

DROP INDEX IF EXISTS "access_requests_instanceId_idx";
ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS "access_requests_instanceId_fkey";
ALTER TABLE access_requests DROP COLUMN "instanceId";

ALTER TABLE access_requests
  ADD CONSTRAINT "access_requests_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES subscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "access_requests_subscriptionId_idx" ON access_requests("subscriptionId");

-- ─────────────────────────────────────────────────────────────────────────
-- 5. cost_daily_rollups: employeeInstanceId → subscriptionId
--    该列此前恒为 null（会话从未挂过实例），无数据可搬，纯重命名。
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE cost_daily_rollups
  RENAME COLUMN "employeeInstanceId" TO "subscriptionId";

-- 旧的唯一性是以索引而非表约束的形式建的，DROP CONSTRAINT 对它无效。
-- 且 RENAME COLUMN 会让索引定义跟着改列名，不删的话会留下一个覆盖列
-- 完全相同、名字却还带 employeeInstan 的重复索引。
DROP INDEX IF EXISTS "cost_daily_rollups_enterpriseId_departmentId_employeeInstan_key";
ALTER TABLE cost_daily_rollups
  DROP CONSTRAINT IF EXISTS "cost_daily_rollups_enterpriseId_departmentId_employeeInstan_key";

CREATE UNIQUE INDEX IF NOT EXISTS "cost_daily_rollups_enterpriseId_departmentId_subscriptionId_key"
  ON cost_daily_rollups("enterpriseId", "departmentId", "subscriptionId", "modelId", date);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. 删表，然后校验最终状态
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE employee_instances;
DROP TYPE "InstanceStatus";

-- 校验放在删表之后：employee_instances 自身的索引名当然带 instance 字样，
-- 放在删表前会把它们误判成残留。
DO $$
DECLARE
  leftover_cols INT;
  leftover_idx  INT;
BEGIN
  SELECT COUNT(*) INTO leftover_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name IN ('instanceId', 'employeeInstanceId');
  IF leftover_cols > 0 THEN
    RAISE EXCEPTION '仍有 % 处 instanceId 列未迁移，中止', leftover_cols;
  END IF;

  -- 索引名也要查：RENAME COLUMN 只改索引的列引用、不改索引名，
  -- 漏删会留下一个覆盖列相同但名字误导的重复索引。
  SELECT COUNT(*) INTO leftover_idx
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname ILIKE '%instance%';
  IF leftover_idx > 0 THEN
    RAISE EXCEPTION '仍有 % 个索引名残留 instance 字样，中止', leftover_idx;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. cart_items 去掉 quantity —— 一企业一员工只雇佣一次，数量无意义。
--    order_items.quantity 保留：已成交订单的记录形状不应被改写。
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE cart_items DROP COLUMN quantity;

COMMIT;

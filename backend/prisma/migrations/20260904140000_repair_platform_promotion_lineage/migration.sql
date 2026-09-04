-- 纯数据修复，不改结构。修两件由「投稿有两套写法」留下的存量问题。
--
-- 1) 采纳产生的企业版本没有 parentVersionId。
--    adoptPersonalVersions / createEnterpriseVersionFromContent 都算出了合并基线却
--    没写进 parentVersionId，于是「无父版本 + 无来源」被界面判定成「原始版本」——
--    一条「采纳 XX 的改动」被标成原始正文，版本时间线上的血缘也断了。
--    代码已修，这里回填历史行。
--
-- 2) scope=ENTERPRISE 的行带着平台状态（PENDING_PLATFORM_REVIEW / PLATFORM_APPROVED）。
--    贡献中心那条投稿路径原来不复制副本、直接改企业行的状态，后果有两个：
--      · 待审列表里出现 scope=ENTERPRISE 的行，点通过必然 404
--        （reviewPlatformVersion 只认 scope=PLATFORM）；
--      · 审核通过后企业行变成 PLATFORM_APPROVED，而平台谱系里一个版本都没有 ——
--        MARKET_PUBLIC 的能力被别的企业订阅时 resolveEffectiveVersion 找不到正文。
--    代码已改成复制副本，这里给存量行补上缺失的平台副本，并把企业行退回
--    ENTERPRISE_APPROVED（它被错误翻牌之前就是这个状态）。

-- ── 1) 回填 parentVersionId ──────────────────────────────────────────────
-- 基线口径与 resolveEnterpriseBaseline 一致：先找本企业更早的企业版，
-- 再退到该能力更早的平台版。两者都没有说明它确实是第一版，保持 NULL。
WITH candidate AS (
  SELECT id, "capabilityId", "enterpriseId", "createdAt"
  FROM skill_versions
  WHERE scope = 'ENTERPRISE'
    AND "parentVersionId" IS NULL
    AND "sourceVersionId" IS NULL
),
resolved AS (
  SELECT c.id,
         COALESCE(
           (SELECT prev.id
              FROM skill_versions prev
             WHERE prev.scope = 'ENTERPRISE'
               AND prev."capabilityId" = c."capabilityId"
               AND prev."enterpriseId" = c."enterpriseId"
               AND prev."createdAt" < c."createdAt"
             ORDER BY prev."createdAt" DESC
             LIMIT 1),
           (SELECT plat.id
              FROM skill_versions plat
             WHERE plat.scope = 'PLATFORM'
               AND plat."capabilityId" = c."capabilityId"
               AND plat."createdAt" < c."createdAt"
             ORDER BY plat."createdAt" DESC
             LIMIT 1)
         ) AS parent_id
    FROM candidate c
)
UPDATE skill_versions sv
   SET "parentVersionId" = r.parent_id
  FROM resolved r
 WHERE sv.id = r.id
   AND r.parent_id IS NOT NULL;

-- ── 2) 给错位的企业行补平台副本 ──────────────────────────────────────────
-- 版本号：企业投稿的能力平台通常没有自建版本，直接沿用企业版号；万一占用了就把
-- patch 段推到该 major.minor 下的最大值 +1，避免撞 platform_version_key。
-- 版本号不是三段纯数字的行跳过 —— 拆不动的字符串宁可留给人工处理，不猜。
WITH broken AS (
  SELECT sv.*
    FROM skill_versions sv
   WHERE sv.scope = 'ENTERPRISE'
     AND sv.status IN ('PENDING_PLATFORM_REVIEW', 'PLATFORM_APPROVED')
     AND sv.version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
     AND NOT EXISTS (
           SELECT 1 FROM skill_versions copy WHERE copy."sourceVersionId" = sv.id
         )
),
numbered AS (
  SELECT b.*,
         CASE
           WHEN pv.max_patch IS NULL THEN b.version
           ELSE split_part(b.version, '.', 1) || '.' || split_part(b.version, '.', 2)
                || '.' || (pv.max_patch + 1)::text
         END AS platform_version,
         (SELECT p.id
            FROM skill_versions p
           WHERE p.scope = 'PLATFORM'
             AND p."capabilityId" = b."capabilityId"
             AND p.status = 'PLATFORM_APPROVED'
           ORDER BY p."createdAt" DESC
           LIMIT 1) AS platform_parent_id,
         e.name AS enterprise_name
    FROM broken b
    LEFT JOIN enterprises e ON e.id = b."enterpriseId"
    LEFT JOIN LATERAL (
      SELECT max((split_part(p.version, '.', 3))::int) AS max_patch
        FROM skill_versions p
       WHERE p.scope = 'PLATFORM'
         AND p."capabilityId" = b."capabilityId"
         AND p.version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
         AND split_part(p.version, '.', 1) = split_part(b.version, '.', 1)
         AND split_part(p.version, '.', 2) = split_part(b.version, '.', 2)
    ) pv ON TRUE
)
INSERT INTO skill_versions (
  id, "capabilityId", scope, "enterpriseId", "parentVersionId", "sourceVersionId",
  version, content, "changeSummary", status, "createdById", "submittedAt",
  "platformReviewedById", "platformReviewedAt", "packageKey", "packageSha256",
  "packageFileCount", "packageFilename", "createdAt", "updatedAt"
)
SELECT
  'rec' || replace(gen_random_uuid()::text, '-', ''),
  n."capabilityId",
  'PLATFORM',
  NULL,
  COALESCE(n.platform_parent_id, n."parentVersionId"),
  n.id,
  n.platform_version,
  n.content,
  '平台采纳 ' || COALESCE(n.enterprise_name, '企业') || ' 的 v' || n.version
    || COALESCE(' —— ' || n."changeSummary", '') || '（补录：原企业版本被直接改状态）',
  n.status,
  n."createdById",
  COALESCE(n."submittedAt", n."updatedAt"),
  n."platformReviewedById",
  n."platformReviewedAt",
  n."packageKey",
  n."packageSha256",
  n."packageFileCount",
  n."packageFilename",
  n."createdAt",
  CURRENT_TIMESTAMP
  FROM numbered n;

-- 企业行退回它被错误翻牌之前的状态。只退有平台副本兜着的行，
-- 免得把「补不出副本」的行也一起改掉、丢掉唯一的状态线索。
UPDATE skill_versions sv
   SET status = 'ENTERPRISE_APPROVED'
 WHERE sv.scope = 'ENTERPRISE'
   AND sv.status IN ('PENDING_PLATFORM_REVIEW', 'PLATFORM_APPROVED')
   AND EXISTS (SELECT 1 FROM skill_versions copy WHERE copy."sourceVersionId" = sv.id);

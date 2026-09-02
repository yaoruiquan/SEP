-- 下线企业内提审流（会议纪要2 §6.4 明确否掉「普通员工上传+提审」）
--
-- 后端的 submitEnterpriseReview / reviewEnterpriseVersion 已删除，
-- 新的路径是「员工改个人副本 → 管理员采纳」+「管理员建草稿 → 发布并生效」。
--
-- 存量卡在 PENDING_ENTERPRISE_REVIEW 的版本没有审核入口了，退回 DRAFT ——
-- 它们从未通过审核，DRAFT 才是诚实的状态，且管理员可以直接发布。
-- ENTERPRISE_REJECTED 不动：它记录了「这一版被拒过」这个事实，
-- 改成 DRAFT 会丢掉 rejectionReason 的语境。
--
-- 两个枚举值保留：PostgreSQL 删枚举值要重建类型，而历史行仍需要能读出来。

UPDATE "skill_versions"
SET "status" = 'DRAFT'
WHERE "status" = 'PENDING_ENTERPRISE_REVIEW'
  AND "scope" = 'ENTERPRISE';

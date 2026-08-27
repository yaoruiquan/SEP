-- Subscriptions created before the quota system did not receive a quota row.
-- Keep the same 100k-token allowance used by SubscriptionService.create().
INSERT INTO "subscription_quotas" (
  "id",
  "subscriptionId",
  "enterpriseId",
  "totalTokens",
  "usedTokens",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  'quota_' || s."id",
  s."id",
  s."enterpriseId",
  100000,
  0,
  'ACTIVE',
  NOW(),
  NOW()
FROM "subscriptions" s
WHERE s."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "subscription_quotas" q
    WHERE q."subscriptionId" = s."id"
  );

-- Add metadata required by the authenticated client employee access request API.
ALTER TABLE "subscription_requests"
  ADD COLUMN "clientIdempotencyKey" TEXT,
  ADD COLUMN "clientRequestFingerprint" TEXT,
  ADD COLUMN "clientTargetType" TEXT,
  ADD COLUMN "requestedCapabilities" JSONB;

CREATE UNIQUE INDEX "subscription_requests_clientIdempotencyKey_key"
  ON "subscription_requests"("clientIdempotencyKey");

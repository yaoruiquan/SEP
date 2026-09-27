-- Add request context used for new-device detection and security notifications.
ALTER TABLE "auth_sessions" ADD COLUMN "ip_address" TEXT;
ALTER TABLE "auth_sessions" ADD COLUMN "user_agent" TEXT;

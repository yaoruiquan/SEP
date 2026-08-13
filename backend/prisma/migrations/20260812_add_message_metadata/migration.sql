-- AlterTable
-- 为 messages 表添加 metadata 字段，用于多员工协作功能
ALTER TABLE "messages" ADD COLUMN "metadata" JSONB;

COMMENT ON COLUMN "messages"."metadata" IS '多员工协作：记录实际处理该消息的员工 ID（如果切换了员工）';

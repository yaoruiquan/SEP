-- AlterTable
-- 为 messages 表添加 attachments 字段，用于多模态输入（图片/文档/视频）
--
-- 用 IF NOT EXISTS 而非裸 ADD COLUMN：本仓库已多次出现 db push 与 migrate
-- 混用导致列先于迁移存在、后续迁移全线卡死（P3018）的情况。加列是幂等操作，
-- 这样写在全新库和已漂移的本地库上都能过。
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachments" JSONB;

COMMENT ON COLUMN "messages"."attachments" IS '多模态附件：[{ type, key, url, name, size, mimeType }]，key 为存储对象永久标识，url 为签名链接（有时效）';

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Restore missing DDL without changing migration history or legacy embeddings.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
ALTER TABLE public.text_chunks
  ADD COLUMN IF NOT EXISTS "embeddingVector" vector(1024);
CREATE INDEX IF NOT EXISTS "text_chunks_embeddingVector_hnsw_idx"
  ON public.text_chunks USING hnsw ("embeddingVector" vector_cosine_ops)
  WHERE "embeddingVector" IS NOT NULL;

\ir verify-knowledge-schema.sql
COMMIT;

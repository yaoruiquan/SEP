-- Phase 2: database-native vector search for bge-m3 (1024 dimensions).
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "text_chunks"
  ADD COLUMN "embeddingVector" vector(1024);

-- HNSW keeps retrieval inside PostgreSQL instead of loading all vectors into Node.
CREATE INDEX "text_chunks_embeddingVector_hnsw_idx"
  ON "text_chunks" USING hnsw ("embeddingVector" vector_cosine_ops)
  WHERE "embeddingVector" IS NOT NULL;

-- Existing BYTEA vectors remain available for the compatibility fallback.

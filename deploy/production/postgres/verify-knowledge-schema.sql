\set ON_ERROR_STOP on
-- Assertions only; callers may include this file in a repair transaction.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'Knowledge schema: public.vector extension is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('public.text_chunks')
      AND attname = 'embeddingVector' AND NOT attisdropped
      AND format_type(atttypid, atttypmod) = 'vector(1024)'
  ) THEN
    RAISE EXCEPTION 'Knowledge schema: text_chunks.embeddingVector must be vector(1024)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_indexes v
      ON v.schemaname = 'public'
      AND v.indexname = 'text_chunks_embeddingVector_hnsw_idx'
    WHERE i.indexrelid = to_regclass('public."text_chunks_embeddingVector_hnsw_idx"')
      AND i.indrelid = to_regclass('public.text_chunks')
      AND i.indisvalid AND i.indisready
      AND v.indexdef LIKE '%USING hnsw ("embeddingVector" vector_cosine_ops)%'
      AND pg_get_expr(i.indpred, i.indrelid) = '("embeddingVector" IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'Knowledge schema: valid partial HNSW cosine index is missing';
  END IF;
END
$$;

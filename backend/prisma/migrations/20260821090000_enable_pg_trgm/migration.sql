-- Lexical knowledge-base search uses PostgreSQL's similarity() function.
-- Keep this idempotent so existing production databases can be upgraded safely.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

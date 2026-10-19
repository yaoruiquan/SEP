# Shared PostgreSQL: pgvector Maintenance

This is an explicitly approved shared-infrastructure maintenance operation, not
part of SEP's ordinary application deployment. Never recreate PostgreSQL from
`sep-deploy.sh`.

## Pinned Build

The production baseline verified on 2026-10-19 is PostgreSQL 18.4, x86_64,
Alpine 3.24.1. `Dockerfile` extends its exact image digest, builds pgvector 0.8.1
at commit `778dacf20c07caf904557a88705142631818d8cb`, checks the source archive,
and copies only extension files into the unchanged runtime image. It disables
host-specific CPU instructions and optional LLVM bitcode generation.

```bash
docker build -f deploy/production/postgres/Dockerfile \
  -t longdao-postgres-pgvector:18.4-v0.8.1-9a8afca54e78 \
  deploy/production/postgres
```

Do not replace the existing database with a different PostgreSQL major version,
libc variant, or an unverified floating image tag. Update the shared stack's
PostgreSQL image reference persistently, without modifying its other services.
The production `PGDATA=/var/lib/postgresql/data` and named volume mount must
remain unchanged; PostgreSQL 18 image defaults differ from this existing setup.

## Release Gates

1. Save the current container configuration and shared Compose file in a
   root-only backup directory. Back up every shared database and global roles.
   Never commit environment files, password hashes, or database dumps.
2. Restore all databases and role ownership/ACLs into a network-isolated,
   disposable instance of the new image. A readable dump catalog alone is not a
   recovery rehearsal. Keep a separate original role backup; the rehearsal can
   omit role passwords.
3. Run the repair against the restored SEP database, then run it again to prove
   idempotency. Check that missing/wrong columns and invalid indexes fail the
   verification script. Compare the original user documents/chunks, not just
   migration history. Do not backfill or relabel legacy embeddings.
4. Run the actual application pipeline against a separate empty, migrated test
   database, private storage, and Redis. Use the real pinned tokenizer and
   Ollama model, synthetic documents, native-vector-only retrieval, and source
   permission tests. Never point a second application worker at production.
5. Announce maintenance before recreating only the shared PostgreSQL service.
   SEP and sub2api database requests may fail during this interval. Preserve the
   original data volume, network aliases, access restrictions, and resource
   limits. Confirm all existing databases are available after startup.
6. As the database administrator, apply the additive repair only to `sep_prod`.
   Copy both SQL files to the same directory inside the container, then use
   `psql -X -v ON_ERROR_STOP=1 -f repair-knowledge-vector.sql`. The included
   verification runs before the repair transaction commits. The five-second
   lock timeout and sixty-second statement timeout fail closed.
7. Deploy SEP normally. `check_knowledge_schema` independently checks the actual
   extension, dimension, and valid partial cosine HNSW index after migrations
   and before any candidate starts. Verify SEP, sub2api, and the dev environment.

The repair restores missing DDL from an already-recorded historical migration.
It does not edit migration SQL/checksums, `_prisma_migrations`, existing BYTEA
embeddings, model labels, documents, or original files. Existing chunks remain
NULL in the new native-vector column; administrators must explicitly publish
compatible new versions before relying on native vector retrieval for them.

## Rollback

Before schema repair, a failed replacement can use the preserved old image and
original Compose configuration with the same volume. Do not initialize a fresh
volume or restore dumps over a running production database.

After the extension is in use, prefer rolling back SEP alone while retaining the
healthy pgvector-capable database image. The old vanilla PostgreSQL image lacks
the extension library and must not be started against vector-dependent schemas.
Removing the extension/column or restoring a physical snapshot needs a separate
assessment of writes since maintenance; never use `DROP EXTENSION ... CASCADE`.

## Local Checks

```bash
bash -n deploy/production/sep-deploy.sh
bash deploy/production/test-sep-deploy.sh
```

Upstream implementation: <https://github.com/pgvector/pgvector/tree/778dacf20c07caf904557a88705142631818d8cb>

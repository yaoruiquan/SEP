# ADR-0003: Isolate Capability Objects Behind ObjectStorage

Status: Accepted  
Date: 2026-07-10

## Context

Capability packages require immutable binary storage. Local development should
not depend on an additional object-storage service, while deployment needs an
S3-compatible backend.

## Decision

Define a narrow `ObjectStorage` port. Use local filesystem storage for P0 local
development and AWS SDK v3 for S3-compatible deployment. Domain modules may not
use MinIO-specific APIs.

## Consequences

Local setup remains small and deployment storage can change without modifying
domain logic. Both adapters require shared conformance tests.

## Rejected Options

- Mandatory MinIO in all environments: adds a P0 service dependency.
- Store packages in PostgreSQL: increases database load and backup coupling.

## Review Trigger

Review when retention, replication, signed download, or multi-region requirements
become concrete.


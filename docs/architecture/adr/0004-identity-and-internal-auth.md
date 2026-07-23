# ADR-0004: Use Identity Adapters And HMAC Internal Authentication

Status: Accepted; the "SEP must not implement a password system" clause is
superseded by [ADR-0007](0007-账号认证与多受众会话.md) (2026-07-16). The
identity-adapter boundary and the HMAC internal-authentication decision remain
in force — ADR-0007 only changes how end-user identities are established.  
Date: 2026-07-10

## Context

P0 needs deterministic local identities and secure Gateway-to-Platform calls,
but building an account/password system is outside the product scope.

## Decision

Use a seeded bearer-token adapter in local and acceptance environments. Use a
standard OIDC/JWT identity provider in production. Authenticate Gateway internal
requests with HMAC covering method, path, timestamp, and body digest; enforce a
60-second window, constant-time comparison, nonce or digest replay protection,
and key-ID-based rotation.

## Consequences

Identity remains replaceable and internal calls are independently authenticated.
Clock synchronization, key distribution, and replay storage must be operated.

## Rejected Options

- Custom password database: outside P0 and creates avoidable security ownership.
- Shared static header only: lacks payload integrity and replay resistance.

## Review Trigger

Review before production identity-provider integration or multi-region Gateway
deployment.


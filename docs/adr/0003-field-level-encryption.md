# ADR 0003 — Field-level envelope encryption for PHI

**Status:** Accepted (Phase A)
**Date:** 2025-05-25

## Context

The plan mandates field-level encryption for protected health information so
that a stolen DB dump is not a PHI breach by itself.

## Decision

Use an **envelope-encryption** scheme:

1. A single **Key Management Service (KMS)** owns the master key. In
   development we ship a `LocalKmsAdapter` that reads
   `ENCRYPTION_MASTER_KEY` (32 bytes, base64) from the environment. In
   production this is replaced by a real adapter (AWS KMS / GCP KMS /
   self-hosted Vault) behind the same `KmsPort` interface.
2. Per-tenant **Data Encryption Keys (DEKs)** are derived from the master key
   via HKDF-SHA256 with the tenant id as the info parameter. DEKs never
   touch persistent storage in dev; in production the KMS adapter wraps and
   stores them.
3. Field values are encrypted with **AES-256-GCM**. Ciphertext is stored as a
   self-describing string:

   ```
   v1.<base64 IV (12 B)>.<base64 GCM tag (16 B)>.<base64 ciphertext>
   ```

   The `v1` prefix supports future migrations to AES-GCM-SIV or
   ChaCha20-Poly1305 without a flag day.

4. The `FieldEncryptionService` exposes `encrypt(tenantId, plaintext)` and
   `decrypt(tenantId, payload)`. PHI fields on entities are tagged with the
   `@Phi()` decorator so the audit interceptor and the
   `data-export` job can find them.

## Consequences

- PHI at rest is encrypted with a per-tenant DEK. Multi-tenant DB dumps cannot
  be decrypted en masse — each tenant has its own DEK.
- The IV is generated per encryption (`randomBytes(12)`), so deterministic
  search on encrypted fields is **not supported**. Indexable PHI fields will
  need a separate `*_search_hash` HMAC column in Phase B.
- The KMS dependency is centralized behind a single port; swapping providers
  is a non-event.

## Alternatives considered

- **Whole-DB encryption at rest only:** does not protect against application
  compromise or DBA exfiltration. Insufficient on its own.
- **Column-level pgcrypto:** ties us to PostgreSQL and complicates DB-mode
  tenancy. Application-side encryption is provider-neutral.

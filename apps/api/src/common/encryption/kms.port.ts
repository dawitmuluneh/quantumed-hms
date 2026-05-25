/**
 * Port (interface) for KMS implementations. Phase A ships the
 * LocalKmsAdapter which derives a tenant DEK from a master key + tenant id
 * using HKDF-SHA-256. Production swap-in (AWS KMS / GCP KMS / HashiCorp Vault)
 * implements this same interface.
 */
export interface KmsPort {
  /** Returns a 32-byte data-encryption key derived for the given tenant. */
  getTenantDek(tenantId: string): Promise<Buffer>;
}

export const KMS_PORT = Symbol('KMS_PORT');

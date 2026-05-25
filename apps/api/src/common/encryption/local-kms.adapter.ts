import { createHmac } from 'node:crypto';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { KmsPort } from './kms.port';

/**
 * Development / single-host KMS implementation. Derives a per-tenant DEK from
 * `ENCRYPTION_MASTER_KEY` via HKDF (extract+expand) so that backups of one
 * tenant are unusable without that tenant's id and the master key. NOT
 * suitable for production multi-region deployments — swap in
 * AwsKmsAdapter / VaultKmsAdapter via DI in production.
 */
@Injectable()
export class LocalKmsAdapter implements KmsPort, OnModuleInit {
  private readonly logger = new Logger(LocalKmsAdapter.name);
  private masterKey!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('ENCRYPTION_MASTER_KEY') ?? '';
    if (!raw) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY missing — refusing to start without an encryption root',
      );
    }
    // Accept base64 or utf-8 32 byte string. Hash to 32 bytes either way.
    const buf =
      /^[A-Za-z0-9+/=]+$/.test(raw) && raw.length >= 16
        ? Buffer.from(raw, 'base64')
        : Buffer.from(raw, 'utf8');
    this.masterKey = this.normalize(buf);
    this.logger.log(`Local KMS initialised with ${this.masterKey.length}-byte master key`);
  }

  async getTenantDek(tenantId: string): Promise<Buffer> {
    const prk = createHmac('sha256', this.masterKey).update('quantumed:hkdf:extract').digest();
    const okm = createHmac('sha256', prk)
      .update(`quantumed:hkdf:expand:tenant:${tenantId}`)
      .digest();
    return okm.subarray(0, 32);
  }

  private normalize(buf: Buffer): Buffer {
    if (buf.length === 32) return buf;
    return createHmac('sha256', 'quantumed:master-key-normalize').update(buf).digest();
  }
}

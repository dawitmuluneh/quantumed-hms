import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { KMS_PORT, KmsPort } from './kms.port';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = 1;

/**
 * AES-256-GCM authenticated envelope encryption for PHI fields. Output layout:
 *   v1.<base64(iv)>.<base64(tag)>.<base64(ciphertext)>
 *
 * Backwards-compat is preserved by version-prefixing.
 */
@Injectable()
export class FieldEncryptionService {
  constructor(@Inject(KMS_PORT) private readonly kms: KmsPort) {}

  async encrypt(tenantId: string, plaintext: string): Promise<string> {
    const dek = await this.kms.getTenantDek(tenantId);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      `v${VERSION}`,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  async decrypt(tenantId: string, payload: string): Promise<string> {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== `v${VERSION}`) {
      throw new Error('Invalid encrypted payload');
    }
    const iv = Buffer.from(parts[1] ?? '', 'base64');
    const tag = Buffer.from(parts[2] ?? '', 'base64');
    const ciphertext = Buffer.from(parts[3] ?? '', 'base64');
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
      throw new Error('Invalid IV / tag length');
    }
    const dek = await this.kms.getTenantDek(tenantId);
    const decipher = createDecipheriv(ALGO, dek, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }
}

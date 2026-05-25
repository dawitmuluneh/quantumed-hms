import { FieldEncryptionService } from './field-encryption.service';
import { KmsPort } from './kms.port';

class FakeKms implements KmsPort {
  async getTenantDek(tenantId: string): Promise<Buffer> {
    // Deterministic per-tenant key for test stability.
    return Buffer.alloc(32, tenantId.charCodeAt(0));
  }
}

describe('FieldEncryptionService', () => {
  const svc = new FieldEncryptionService(new FakeKms());

  it('round-trips utf-8 plaintext', async () => {
    const ct = await svc.encrypt('demo', 'Patient: John Smith, DOB 1980-01-01');
    expect(ct.startsWith('v1.')).toBe(true);
    const pt = await svc.decrypt('demo', ct);
    expect(pt).toBe('Patient: John Smith, DOB 1980-01-01');
  });

  it('produces different ciphertext on each call (random IV)', async () => {
    const a = await svc.encrypt('demo', 'hello');
    const b = await svc.encrypt('demo', 'hello');
    expect(a).not.toEqual(b);
  });

  it('rejects ciphertext from a different tenant', async () => {
    const ct = await svc.encrypt('alpha', 'secret');
    await expect(svc.decrypt('beta', ct)).rejects.toThrow();
  });

  it('rejects malformed payload', async () => {
    await expect(svc.decrypt('demo', 'garbage')).rejects.toThrow();
    await expect(svc.decrypt('demo', 'v2.a.b.c')).rejects.toThrow();
  });
});

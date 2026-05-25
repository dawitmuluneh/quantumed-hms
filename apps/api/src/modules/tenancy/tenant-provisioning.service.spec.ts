import { TenantProvisioningService } from './tenant-provisioning.service';

describe('TenantProvisioningService.toSchemaName', () => {
  it('produces a valid schema name for a clean slug', () => {
    expect(TenantProvisioningService.toSchemaName('demo')).toBe('tenant_demo');
  });

  it('lowercases and replaces non-alphanumerics', () => {
    expect(TenantProvisioningService.toSchemaName('Acme Hospital!')).toBe('tenant_acme_hospital');
  });

  it('truncates long slugs to fit identifier limits', () => {
    const long = 'a'.repeat(100);
    const name = TenantProvisioningService.toSchemaName(long);
    expect(name.startsWith('tenant_')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(55);
  });

  it('falls back to tenant_default for empty input', () => {
    expect(TenantProvisioningService.toSchemaName('---')).toBe('tenant_default');
  });
});

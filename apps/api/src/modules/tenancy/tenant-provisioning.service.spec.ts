import { TenantProvisioningService, splitStatements } from './tenant-provisioning.service';

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

describe('splitStatements', () => {
  it('splits a simple two-statement script', () => {
    const sql = 'CREATE TABLE a (id int);\nCREATE TABLE b (id int);';
    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (id int)', 'CREATE TABLE b (id int)']);
  });

  it('does not split on semicolons inside single-quoted literals', () => {
    const sql = "INSERT INTO t (val) VALUES ('a;b;c');\nSELECT 1;";
    expect(splitStatements(sql)).toEqual(["INSERT INTO t (val) VALUES ('a;b;c')", 'SELECT 1']);
  });

  it('handles SQL-escaped single quotes (doubled) inside string literals', () => {
    const sql = "INSERT INTO t (val) VALUES ('it''s ok; really');";
    expect(splitStatements(sql)).toEqual(["INSERT INTO t (val) VALUES ('it''s ok; really')"]);
  });

  it('ignores line comments containing semicolons', () => {
    const sql = '-- this; is; a; comment;\nSELECT 1;';
    expect(splitStatements(sql)).toEqual(['-- this; is; a; comment;\nSELECT 1']);
  });

  it('preserves the trailing statement when no terminating semicolon', () => {
    const sql = 'SELECT 1';
    expect(splitStatements(sql)).toEqual(['SELECT 1']);
  });

  it('drops empty trailing statements', () => {
    const sql = 'SELECT 1;\n\n;\n';
    expect(splitStatements(sql)).toEqual(['SELECT 1']);
  });

  it('does not split on semicolons inside block comments', () => {
    const sql = '/* one; two; three */ SELECT 1;';
    expect(splitStatements(sql)).toEqual(['/* one; two; three */ SELECT 1']);
  });
});

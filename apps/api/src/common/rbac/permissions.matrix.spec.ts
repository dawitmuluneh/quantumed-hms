import { isPermitted } from './permissions.matrix';

describe('isPermitted', () => {
  it('allows super_admin to manage hospitals', () => {
    expect(isPermitted(['super_admin'], 'hospital', 'create')).toBe(true);
    expect(isPermitted(['super_admin'], 'hospital', 'delete')).toBe(true);
  });

  it('rejects unknown role', () => {
    expect(isPermitted(['gardener'], 'hospital', 'create')).toBe(false);
  });

  it('does not allow doctor to delete patients', () => {
    expect(isPermitted(['doctor'], 'patient', 'delete')).toBe(false);
  });

  it('allows doctor to read patients', () => {
    expect(isPermitted(['doctor'], 'patient', 'read')).toBe(true);
  });

  it('treats `manage` as a superset of read/update/delete', () => {
    expect(isPermitted(['admin'], 'patient', 'read')).toBe(true);
    expect(isPermitted(['admin'], 'patient', 'delete')).toBe(true);
  });

  it('honours union of multiple roles', () => {
    expect(isPermitted(['nurse', 'accountant'], 'invoice', 'create')).toBe(true);
    expect(isPermitted(['nurse'], 'invoice', 'create')).toBe(false);
  });

  it('patient cannot read foreign audit logs', () => {
    expect(isPermitted(['patient'], 'audit_log', 'read')).toBe(false);
  });
});

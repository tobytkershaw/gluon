import { describe, it, expect } from 'vitest';
import { getMixRole, getMixRoleList, ROLE_NAMES } from '../../src/engine/mix-roles';

describe('mix-roles', () => {
  it('ROLE_NAMES is non-empty', () => {
    expect(ROLE_NAMES.length).toBeGreaterThan(0);
  });

  it('getMixRole returns undefined for unknown role', () => {
    expect(getMixRole('nonexistent')).toBeUndefined();
  });

  it('getMixRole returns a role for each known name', () => {
    for (const name of ROLE_NAMES) {
      const role = getMixRole(name);
      expect(role).toBeDefined();
      expect(role!.name).toBe(name);
    }
  });

  it('every role has volume in 0-1 range', () => {
    for (const name of ROLE_NAMES) {
      const role = getMixRole(name)!;
      expect(role.defaults.volume).toBeGreaterThanOrEqual(0);
      expect(role.defaults.volume).toBeLessThanOrEqual(1);
    }
  });

  it('every role has pan in 0-1 range', () => {
    for (const name of ROLE_NAMES) {
      const role = getMixRole(name)!;
      expect(role.defaults.pan).toBeGreaterThanOrEqual(0);
      expect(role.defaults.pan).toBeLessThanOrEqual(1);
    }
  });

  it('every role has non-empty description', () => {
    for (const name of ROLE_NAMES) {
      const role = getMixRole(name)!;
      expect(role.description.length).toBeGreaterThan(0);
    }
  });

  it('getMixRoleList returns all roles', () => {
    const list = getMixRoleList();
    expect(list.length).toBe(ROLE_NAMES.length);
    for (const entry of list) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  it('includes expected roles', () => {
    expect(getMixRole('lead')).toBeDefined();
    expect(getMixRole('pad')).toBeDefined();
    expect(getMixRole('rhythm_foundation')).toBeDefined();
    expect(getMixRole('sub')).toBeDefined();
    expect(getMixRole('texture')).toBeDefined();
    expect(getMixRole('accent')).toBeDefined();
  });
});

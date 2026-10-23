import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { adminPasswordProblem } from '../src/admin/security.js';

describe('configuration', () => {
  it('has safe defaults', () => {
    expect(parseConfig({})).toMatchObject({ port: 3000, backupEveryHours: 24, backupKeep: 14, trustProxy: false, secureCookies: false });
  });

  it('refuses hop counts and "true" for TRUST_PROXY, keeps address lists', () => {
    expect(() => parseConfig({ TRUST_PROXY: '1' })).toThrow(/pas un nombre/);
    expect(() => parseConfig({ TRUST_PROXY: 'true' })).toThrow(/pas un nombre/);
    expect(parseConfig({ TRUST_PROXY: 'loopback, uniquelocal' }).trustProxy).toBe('loopback, uniquelocal');
    expect(parseConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
  });

  it('stops on backup settings that would silently do the wrong thing', () => {
    expect(() => parseConfig({ BACKUP_KEEP: 'quatorze' })).toThrow(/BACKUP_KEEP=quatorze/);
    expect(() => parseConfig({ BACKUP_KEEP: '0' })).toThrow(/BACKUP_KEEP/);
    expect(() => parseConfig({ BACKUP_EVERY_HOURS: 'abc' })).toThrow(/BACKUP_EVERY_HOURS/);
    expect(() => parseConfig({ BACKUP_EVERY_HOURS: '1.5' })).toThrow(/BACKUP_EVERY_HOURS/);
    expect(parseConfig({ BACKUP_EVERY_HOURS: '0', BACKUP_KEEP: '3' })).toMatchObject({ backupEveryHours: 0, backupKeep: 3 });
  });

  it('refuses example and common admin passwords', () => {
    expect(adminPasswordProblem('change-moi-par-une-phrase-longue')).toMatch(/exemple/);
    expect(adminPasswordProblem('MonPassword2026!')).toMatch(/exemple/);
    expect(adminPasswordProblem('aaaaaaaaaaaaaaaa')).toMatch(/exemple/);
    expect(adminPasswordProblem('court')).toMatch(/12 caractères/);
    expect(adminPasswordProblem('correct-horse-battery')).toBeNull();
  });
});

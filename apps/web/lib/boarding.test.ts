import { describe, expect, it } from 'vitest';
import { getT } from './i18n';
import { areaForPath, areaLabel, homePathForRole, roleLabel } from './session';

describe('boarding screens', () => {
  it('sends scanner accounts to the scanner app only', () => {
    expect(homePathForRole('scanner')).toBe('/s');
    expect(homePathForRole('staff')).toBe('/o');
    expect(areaForPath('/s')).toBe('scanner');
    expect(areaForPath('/o/scan')).toBe('operator');
    expect(areaForPath('/a?x=1')).toBe('affiliate');
    expect(areaForPath('/start')).toBeNull();
    expect(areaForPath('/t/123')).toBeNull();
  });

  it('fills placeholders and counts scans in Romanian and English', () => {
    const ro = getT('ro');
    expect(ro.t('boarding.scan.usedAtBy', { when: 'azi la 10:52', who: 'Mihai' })).toBe(
      'Scanat azi la 10:52 de Mihai',
    );
    expect(ro.tp('boarding.app.scannedToday', 1)).toBe('Azi ai scanat 1 bilet');
    expect(ro.tp('boarding.app.scannedToday', 7)).toBe('Azi ai scanat 7 bilete');
    expect(ro.tp('boarding.app.scannedToday', 23)).toBe('Azi ai scanat 23 de bilete');
    const en = getT('en');
    expect(en.tp('boarding.app.scannedToday', 1)).toBe('You scanned 1 ticket today');
    expect(en.tp('boarding.app.scannedToday', 7)).toBe('You scanned 7 tickets today');
  });

  it('names the scanner role and area', () => {
    expect(roleLabel(getT('ro'), 'scanner')).toBe('Scanare bilete');
    expect(areaLabel(getT('en'), 'scanner')).toBe('ticket scanner');
  });
});

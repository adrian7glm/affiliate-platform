import { describe, expect, it } from 'vitest';
import { bt, scannedToday } from './boarding-text';
import { areaForPath, homePathForRole } from './session';

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

  it('fills placeholders and counts scans in Romanian', () => {
    expect(bt('usedAtBy', { when: 'azi la 10:52', who: 'Mihai' })).toBe(
      'Scanat azi la 10:52 de Mihai',
    );
    expect(scannedToday(0)).toBe('Azi nu ai scanat încă bilete');
    expect(scannedToday(1)).toBe('Azi ai scanat 1 bilet');
    expect(scannedToday(7)).toBe('Azi ai scanat 7 bilete');
    expect(scannedToday(23)).toBe('Azi ai scanat 23 de bilete');
  });
});

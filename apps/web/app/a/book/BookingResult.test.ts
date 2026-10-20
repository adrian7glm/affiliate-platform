import { describe, expect, it } from 'vitest';
import { getT } from '@/lib/i18n';
import { customerMessage } from './BookingResult';

describe('customerMessage', () => {
  const data = {
    name: 'Ana Pop',
    product: 'Boat',
    startsAt: '2026-07-01T10:00:00Z',
    url: 'https://x',
  };

  it("writes the departure in the operator's timezone", () => {
    const london = customerMessage('ticket', getT('en'), { ...data, timezone: 'Europe/London' });
    expect(london).toContain('11:00');
    expect(london).not.toContain('13:00');

    const bucharest = customerMessage('ticket', getT('en'), {
      ...data,
      timezone: 'Europe/Bucharest',
    });
    expect(bucharest).toContain('13:00');
  });

  it('uses the operator day, not the phone day', () => {
    const late = { ...data, startsAt: '2026-07-01T23:30:00Z' };
    expect(customerMessage('ticket', getT('en'), { ...late, timezone: 'Europe/London' })).toMatch(
      /July 2\b|2 July/,
    );
    expect(
      customerMessage('ticket', getT('en'), { ...late, timezone: 'America/New_York' }),
    ).toMatch(/July 1\b|1 July/);
  });
});

import { describe, expect, it } from 'vitest';
import { clientKey } from './rate-limit';

describe('clientKey', () => {
  it('keeps IPv4 addresses, also when mapped into IPv6', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('counts every address of one IPv6 /64 network as the same client', () => {
    const a = clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0db8:0001:0002::1')).toBe(a);
    expect(clientKey('2001:db8:1:2::ffff')).toBe(a);
    expect(clientKey('2001:db8:1:3::1')).not.toBe(a);
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
  });
});

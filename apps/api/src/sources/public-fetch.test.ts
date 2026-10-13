import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress } from './public-fetch';

describe('operator system addresses', () => {
  it('refuses the machine itself, private networks and cloud metadata', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.10',
      '169.254.169.254',
      '100.100.1.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      'not-an-ip',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('accepts public addresses', () => {
    for (const address of ['8.8.8.8', '172.32.0.1', '2a00:1450:4001:80b::200e']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('checks the host of a URL, IP literals included', async () => {
    await expect(assertPublicUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicUrl('https://[::1]:8443/api')).rejects.toThrow();
    await expect(assertPublicUrl('https://localhost/api')).rejects.toThrow();
    await expect(assertPublicUrl('https://8.8.8.8/api')).resolves.toBeUndefined();
  });
});

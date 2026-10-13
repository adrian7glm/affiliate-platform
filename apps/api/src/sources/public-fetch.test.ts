import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent, fetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress, publicOnlyLookup } from './public-fetch';

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

describe('the address the connection opens to', () => {
  const server = createServer((_req, res) => res.end('internal'));
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  /** A hostname that passed the first check but now answers with the API's own machine. */
  const rebound = publicOnlyLookup((_host, _options, callback) =>
    callback(null, [{ address: '127.0.0.1', family: 4 }]),
  );

  it('is checked again when connecting, so DNS rebinding is refused', async () => {
    const dispatcher = new Agent({ connect: { lookup: rebound } });
    const error = await fetch(`http://rebind.example:${port}/`, { dispatcher }).catch(
      (e: unknown) => e as Error & { cause?: { code?: string } },
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as { cause?: { code?: string } }).cause?.code).toBe('ENOTPUBLIC');
    await dispatcher.close();
  });

  it('connects when the answer is public', async () => {
    const lookup = publicOnlyLookup((_host, _options, callback) =>
      callback(null, [{ address: '8.8.8.8', family: 4 }]),
    );
    const answers = await new Promise((resolve, reject) =>
      lookup('example.com', { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      ),
    );
    expect(answers).toEqual([{ address: '8.8.8.8', family: 4 }]);
    const single = await new Promise((resolve, reject) =>
      lookup('example.com', {}, (error, address) => (error ? reject(error) : resolve(address))),
    );
    expect(single).toBe('8.8.8.8');
  });
});

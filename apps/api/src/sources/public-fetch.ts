import { type LookupAddress, type LookupAllOptions, lookup as dnsLookup } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, type LookupFunction, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Addresses an operator's system may not live at: the API's own machine, the private network
 * it runs in and the cloud metadata service. Any operator can type a URL in "Connect your
 * system", so without this check they could make the API call internal services for them.
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Throws when the URL's host is, or resolves to, a private address. */
export async function assertPublicUrl(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(`${host} is not a public internet address`);
  }
}

type ResolveAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * The DNS lookup the connection itself uses, refusing private answers. Checking the URL first is
 * not enough on its own: a hostname can answer with a public address for the check and a private
 * one a moment later, when the connection opens (DNS rebinding).
 */
export function publicOnlyLookup(resolve: ResolveAll = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { family: options.family, hints: options.hints, all: true }, (error, all) => {
      if (error) return callback(error, '', 0);
      if (all.length === 0 || all.some((a) => isPrivateAddress(a.address))) {
        const refused: NodeJS.ErrnoException = new Error(
          `${hostname} is not a public internet address`,
        );
        refused.code = 'ENOTPUBLIC';
        return callback(refused, '', 0);
      }
      if (options.all) return callback(null, all);
      return callback(null, all[0]!.address, all[0]!.family);
    });
  };
}

const publicAgent = new Agent({ connect: { lookup: publicOnlyLookup() } });

/**
 * fetch for operator systems in production: public addresses only (checked again when the
 * connection opens), and no redirects. Takes a URL, not a Request.
 */
export const publicFetch: typeof fetch = async (input, init) => {
  if (input instanceof Request) throw new TypeError('publicFetch takes a URL');
  const url = String(input);
  await assertPublicUrl(url);
  const response = await undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    redirect: 'error',
    dispatcher: publicAgent,
  });
  return response as unknown as Response;
};

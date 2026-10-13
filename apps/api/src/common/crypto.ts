import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
  randomInt,
  scrypt,
  type ScryptOptions,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

function hmac(secret: string, purpose: string, value: string): Buffer {
  return createHmac('sha256', secret).update(`${purpose}:${value}`).digest();
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ------------------------------------------------------------------------------------------------
// Session tokens: `v1.<payload>.<signature>`, HMAC-SHA256 over the payload.
// ------------------------------------------------------------------------------------------------

export interface SessionClaims {
  sub: string;
  exp: number;
}

function signClaims(
  secret: string,
  purpose: string,
  sub: string,
  ttlSeconds: number,
  now: number,
): string {
  const payload = b64(JSON.stringify({ sub, exp: Math.floor(now / 1000) + ttlSeconds }));
  return `v1.${payload}.${b64(hmac(secret, purpose, payload))}`;
}

function verifyClaims(
  secret: string,
  purpose: string,
  token: string,
  now: number,
): SessionClaims | null {
  const [version, payload, signature] = token.split('.');
  if (version !== 'v1' || !payload || !signature) return null;
  if (!safeEqual(signature, b64(hmac(secret, purpose, payload)))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionClaims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    return claims.exp * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}

export function signSession(
  secret: string,
  userId: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  return signClaims(secret, 'session', userId, ttlSeconds, now);
}

export function verifySession(
  secret: string,
  token: string,
  now = Date.now(),
): SessionClaims | null {
  return verifyClaims(secret, 'session', token, now);
}

/**
 * Short-lived signed values for one step of a sign-in: the Google `state` and the token the
 * web app exchanges for a session after Google. The purpose keeps one from passing as another.
 */
export function signLoginStep(
  secret: string,
  purpose: 'google-state' | 'login-handoff',
  value: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  return signClaims(secret, `login-step:${purpose}`, value, ttlSeconds, now);
}

export function verifyLoginStep(
  secret: string,
  purpose: 'google-state' | 'login-handoff',
  token: string,
  now = Date.now(),
): string | null {
  return verifyClaims(secret, `login-step:${purpose}`, token, now)?.sub ?? null;
}

// ------------------------------------------------------------------------------------------------
// Passwords: scrypt, `scrypt$<N>$<r>$<p>$<salt>$<hash>`.
// ------------------------------------------------------------------------------------------------

const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 32 };

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, keyLength, options, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keyLength } = SCRYPT;
  const key = await scryptAsync(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, b64(salt), b64(key)].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// ------------------------------------------------------------------------------------------------
// One-time login codes
// ------------------------------------------------------------------------------------------------

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtp(secret: string, destination: string, code: string): string {
  return b64(hmac(secret, 'otp', `${destination}:${code}`));
}

// ------------------------------------------------------------------------------------------------
// Ticket links and QR tokens
// ------------------------------------------------------------------------------------------------

/** Unguessable key that lets a customer open their ticket page without an account. */
export function ticketLinkKey(secret: string, bookingId: string): string {
  return b64(hmac(secret, 'ticket-link', bookingId)).slice(0, 24);
}

export function checkTicketLinkKey(secret: string, bookingId: string, key: string): boolean {
  return safeEqual(key, ticketLinkKey(secret, bookingId));
}

/**
 * Ticket QR codes are signed with Ed25519. The public key can be shipped to a scanner app so
 * tickets can be verified even without a connection. The key pair is derived from APP_SECRET.
 */
export class TicketSigner {
  private readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;

  constructor(secret: string) {
    const seed = hmac(secret, 'ticket-signing-key', 'ed25519');
    // PKCS#8 DER prefix for a raw 32-byte Ed25519 seed.
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    this.privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    this.publicKey = createPublicKey(this.privateKey);
  }

  publicKeyPem(): string {
    return this.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  }

  sign(payload: TicketTokenPayload): string {
    const body = b64(JSON.stringify(payload));
    return `t1.${body}.${b64(sign(null, Buffer.from(body), this.privateKey))}`;
  }

  verify(token: string): TicketTokenPayload | null {
    const [version, body, signature] = token.trim().split('.');
    if (version !== 't1' || !body || !signature) return null;
    try {
      if (!verify(null, Buffer.from(body), this.publicKey, Buffer.from(signature, 'base64url')))
        return null;
      return JSON.parse(Buffer.from(body, 'base64url').toString()) as TicketTokenPayload;
    } catch {
      return null;
    }
  }
}

export interface TicketTokenPayload {
  /** ticket id */
  tid: string;
  /** tenant id */
  ten: string;
  /** booking reference */
  ref: string;
  /** departure, ISO */
  at: string;
  seats: number;
}

// ------------------------------------------------------------------------------------------------
// Human-friendly codes
// ------------------------------------------------------------------------------------------------

/** No 0/O, 1/I/L: codes are read aloud at reception desks and typed on phones. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += ALPHABET[randomInt(0, ALPHABET.length)];
  return code;
}

export function randomToken(bytes = 24): string {
  return b64(Buffer.from(Array.from({ length: bytes }, () => randomInt(0, 256))));
}

export function hashIp(secret: string, ip: string | undefined): string | null {
  return ip ? b64(hmac(secret, 'ip', ip)).slice(0, 22) : null;
}

// ------------------------------------------------------------------------------------------------
// Stored secrets (an operator's API token): AES-256-GCM, `s1.<iv>.<ciphertext>.<tag>`.
// ------------------------------------------------------------------------------------------------

export function sealSecret(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', hmac(secret, 'stored-secret', 'v1'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['s1', b64(iv), b64(ciphertext), b64(cipher.getAuthTag())].join('.');
}

export function openSecret(secret: string, sealed: string): string {
  const [version, iv, ciphertext, tag] = sealed.split('.');
  if (version !== 's1' || !iv || ciphertext === undefined || !tag) {
    throw new Error('unknown secret format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    hmac(secret, 'stored-secret', 'v1'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

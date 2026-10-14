import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
  randomInt,
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
  /** The user's session version when the token was issued (tokens from before it existed: 0). */
  sv: number;
}

function signClaims(secret: string, purpose: string, claims: object): string {
  const payload = b64(JSON.stringify(claims));
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
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as Partial<SessionClaims>;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 <= now) return null;
    return { sub: claims.sub, exp: claims.exp, sv: typeof claims.sv === 'number' ? claims.sv : 0 };
  } catch {
    return null;
  }
}

export function signSession(
  secret: string,
  userId: string,
  ttlSeconds: number,
  now = Date.now(),
  sessionVersion = 0,
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return signClaims(secret, 'session', { sub: userId, exp, sv: sessionVersion });
}

export function verifySession(
  secret: string,
  token: string,
  now = Date.now(),
): SessionClaims | null {
  return verifyClaims(secret, 'session', token, now);
}

/**
 * Proof that the first login step (the SMS/email code) passed, for a person with two-step login
 * on. It is only accepted by the second step, never as a session.
 */
export function signMfaChallenge(
  secret: string,
  userId: string,
  ttlSeconds: number,
  now = Date.now(),
  sessionVersion = 0,
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return signClaims(secret, 'mfa-challenge', { sub: userId, exp, sv: sessionVersion });
}

export function verifyMfaChallenge(
  secret: string,
  token: string,
  now = Date.now(),
): SessionClaims | null {
  return verifyClaims(secret, 'mfa-challenge', token, now);
}

// ------------------------------------------------------------------------------------------------
// Authenticator apps (TOTP, RFC 6238): 6 digits, 30-second steps, SHA-1, base32 secrets.
// ------------------------------------------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new authenticator secret: 160 random bits, base32 as the apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now: number): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 1_000_000).toString().padStart(6, '0');
}

/**
 * The step a code is valid for: the current one or one step either side (phone clocks drift),
 * and only after `lastStep`, so a code that was already used is refused.
 */
export function matchTotp(
  secret: string,
  code: string,
  now: number,
  lastStep: number | null,
): number | null {
  const current = totpStep(now);
  for (const step of [current, current - 1, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (safeEqual(totpCode(secret, step), code)) return step;
  }
  return null;
}

/** The link authenticator apps read from the QR code. */
export function totpUri(secret: string, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** One-time recovery codes for a lost phone, e.g. `K7PQ2-XM9TA`. */
export function generateRecoveryCode(): string {
  return `${randomCode(5)}-${randomCode(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(secret: string, userId: string, code: string): string {
  return b64(hmac(secret, 'recovery-code', `${userId}:${normalizeRecoveryCode(code)}`));
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

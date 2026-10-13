import { describe, expect, it } from 'vitest';
import {
  TicketSigner,
  base32Decode,
  base32Encode,
  matchTotp,
  signMfaChallenge,
  totpCode,
  verifyMfaChallenge,
  checkTicketLinkKey,
  openSecret,
  randomCode,
  sealSecret,
  signSession,
  ticketLinkKey,
  verifySession,
} from './crypto';

const secret = 'test-secret-that-is-long-enough';

describe('crypto helpers', () => {
  it('signs and verifies sessions, rejecting tampering and expiry', () => {
    const token = signSession(secret, 'user-1', 60, 1_000_000);
    expect(verifySession(secret, token, 1_000_000)?.sub).toBe('user-1');
    expect(verifySession(secret, token, 1_000_000 + 61_000)).toBeNull();
    expect(verifySession('another-secret-value', token, 1_000_000)).toBeNull();
    const [v, , s] = token.split('.');
    const forged = `${v}.${Buffer.from(JSON.stringify({ sub: 'admin', exp: 9e9 })).toString('base64url')}.${s}`;
    expect(verifySession(secret, forged, 1_000_000)).toBeNull();
  });

  it('carries the session version, and keeps login challenges apart from sessions', () => {
    expect(verifySession(secret, signSession(secret, 'u', 60, 1_000_000, 3), 1_000_000)?.sv).toBe(
      3,
    );
    const challenge = signMfaChallenge(secret, 'u', 60, 1_000_000);
    expect(verifyMfaChallenge(secret, challenge, 1_000_000)?.sub).toBe('u');
    expect(verifySession(secret, challenge, 1_000_000)).toBeNull();
    expect(
      verifyMfaChallenge(secret, signSession(secret, 'u', 60, 1_000_000), 1_000_000),
    ).toBeNull();
  });

  it('computes authenticator codes like RFC 6238 and refuses a code twice', () => {
    const key = base32Encode(Buffer.from('12345678901234567890'));
    expect(key).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(key).toString()).toBe('12345678901234567890');
    // RFC 6238 test vectors (SHA-1), last 6 of the 8 digits.
    expect(totpCode(key, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(key, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(key, Math.floor(1234567890 / 30))).toBe('005924');
    const now = 1111111109_000;
    const step = matchTotp(key, '081804', now, null);
    expect(step).toBe(Math.floor(1111111109 / 30));
    expect(matchTotp(key, '081804', now, step)).toBeNull();
    // One step of clock drift either way is accepted.
    expect(matchTotp(key, '081804', now + 30_000, null)).toBe(step);
    expect(matchTotp(key, '081804', now + 90_000, null)).toBeNull();
  });

  it('signs ticket tokens that only verify with the same key', () => {
    const signer = new TicketSigner(secret);
    const token = signer.sign({
      tid: 't1',
      ten: 'x',
      ref: 'ABC123',
      at: '2026-10-20T16:00:00Z',
      seats: 2,
    });
    expect(signer.verify(token)?.ref).toBe('ABC123');
    expect(new TicketSigner('a-different-secret-value').verify(token)).toBeNull();
    expect(signer.verify(token.replace('t1.', 't1.x'))).toBeNull();
    expect(signer.publicKeyPem()).toContain('BEGIN PUBLIC KEY');
  });

  it('derives ticket link keys per booking', () => {
    const key = ticketLinkKey(secret, 'booking-1');
    expect(checkTicketLinkKey(secret, 'booking-1', key)).toBe(true);
    expect(checkTicketLinkKey(secret, 'booking-2', key)).toBe(false);
  });

  it('makes codes without ambiguous characters', () => {
    expect(randomCode(200)).toMatch(/^[A-HJKMNP-Z2-9]+$/);
  });

  it('seals stored secrets so only the same app secret opens them', () => {
    const sealed = sealSecret(secret, 'operator-api-token');
    expect(sealed).not.toContain('operator-api-token');
    expect(sealSecret(secret, 'operator-api-token')).not.toBe(sealed);
    expect(openSecret(secret, sealed)).toBe('operator-api-token');
    expect(() => openSecret('another-secret-value', sealed)).toThrow();
  });
});

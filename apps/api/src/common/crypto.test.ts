import { describe, expect, it } from 'vitest';
import {
  TicketSigner,
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

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature, webhookSignature } from './webhook-signature';

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"id":"1","type":"booking.paid"}';

  it('is an HMAC-SHA256 of "<timestamp>.<body>", as docs/webhooks.md tells receivers', () => {
    const expected = createHmac('sha256', secret).update(`1760000000.${body}`).digest('hex');
    expect(webhookSignature(secret, 1760000000, body)).toBe(`sha256=${expected}`);
  });

  it('accepts the signature of an unchanged, recent request only', () => {
    const signature = webhookSignature(secret, 1760000000, body);
    expect(verifyWebhookSignature(secret, 1760000000, body, signature, 1760000100)).toBe(true);
    expect(verifyWebhookSignature(secret, 1760000000, `${body} `, signature, 1760000100)).toBe(
      false,
    );
    expect(verifyWebhookSignature('whsec_other', 1760000000, body, signature, 1760000100)).toBe(
      false,
    );
    // Replayed ten minutes later.
    expect(verifyWebhookSignature(secret, 1760000000, body, signature, 1760000600)).toBe(false);
  });
});

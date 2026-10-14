import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Every webhook request carries `X-Webhook-Signature: sha256=<hex>`, an HMAC-SHA256 of
 * `<X-Webhook-Timestamp>.<raw body>` keyed with the endpoint's secret. The receiver recomputes it
 * to know the request comes from the platform, and rejects old timestamps to stop replays.
 */
export function webhookSignature(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** What a receiver does (docs/webhooks.md); used by the tests to check what we send. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = Buffer.from(webhookSignature(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

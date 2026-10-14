# Webhooks

An operator adds an address in **Integrations** (`/o/integrations`): a Zapier or Make "catch
hook", an n8n workflow, or their own system. The platform then sends an HTTP `POST` to that
address when something happens to a booking.

## Events

| Type                | When                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `booking.confirmed` | Seats are taken for good: paid online, or booked to pay at boarding    |
| `booking.paid`      | The money arrived: online payment, or collected at boarding            |
| `booking.cancelled` | A confirmed booking was cancelled (alone, or with its departure)       |
| `ticket.checked_in` | The ticket was scanned at boarding                                     |
| `webhook.test`      | Only from the "Send a test" button, with a made-up `TEST-0001` booking |

An online booking sends `booking.confirmed` and `booking.paid` together. A pay-at-boarding
booking sends `booking.confirmed` when it is made and `booking.paid` when it is scanned.
Each address can be limited to some of these types; by default it gets all of them.

## Request

```
POST <address>
Content-Type: application/json
User-Agent: AffiliatePlatform-Webhooks/1.0
X-Webhook-Id: 7f1c…            same as body.id
X-Webhook-Event: booking.paid  same as body.type
X-Webhook-Timestamp: 1760000000
X-Webhook-Signature: sha256=5d0b…
```

The body is a `WebhookPayload` (`packages/contracts/src/integrations.ts`):

```json
{
  "id": "7f1c2e4a-…",
  "type": "booking.paid",
  "createdAt": "2026-10-05T08:00:00.000Z",
  "operator": { "id": "…", "slug": "delta-boats", "name": "Delta Boats" },
  "data": {
    "booking": {
      "id": "…",
      "reference": "K7M2QX",
      "status": "confirmed",
      "channel": "qr",
      "paymentMode": "online",
      "paid": true,
      "paidAt": "2026-10-05T08:00:00.000Z",
      "createdAt": "2026-10-05T07:58:12.000Z",
      "cancelledAt": null,
      "trip": { "id": "…", "name": "Delta sunset" },
      "startsAt": "2026-10-06T07:00:00.000Z",
      "endsAt": "2026-10-06T08:30:00.000Z",
      "seats": 2,
      "items": [
        {
          "code": "adult",
          "label": "Adult",
          "quantity": 2,
          "unitAmount": "100.00",
          "unitAmountMinor": 10000
        }
      ],
      "customer": {
        "name": "Ana Pop",
        "email": "ana@example.com",
        "phone": "+40722111222",
        "language": "ro",
        "hotelRoom": null
      },
      "currency": "RON",
      "total": "200.00",
      "totalMinor": 20000,
      "tax": "16.51",
      "taxMinor": 1651,
      "affiliate": { "id": "…", "name": "Hotel Delta" },
      "externalRef": null
    }
  }
}
```

`booking.cancelled` adds `data.cancellation: { reason, refunded }`; `ticket.checked_in` adds
`data.checkIn: { ticketId, checkedInAt }`. Amounts are given both as decimal strings and in
minor units (bani, cents); prices include VAT. Fields may be added over time, never renamed or
removed.

## Checking the signature

Every address has a secret (`whsec_…`), shown when it is added and again with "Show secret key".
The signature is an HMAC-SHA256 of `<X-Webhook-Timestamp>.<raw body>` keyed with that secret:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function isFromPlatform(secret, rawBody, headers) {
  const timestamp = Number(headers['x-webhook-timestamp']);
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false; // replayed
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const given = String(headers['x-webhook-signature'] ?? '');
  return (
    expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  );
}
```

Zapier and Make do not need this; it matters for an operator's own system.

## Delivery and retries

- Any `2xx` answer within 10 seconds counts as received. Redirects are not followed.
- Otherwise the event is sent again after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h
  (8 attempts, about two days), always with the same `id`: receivers should ignore an `id` they
  have already processed.
- `410 Gone` stops at once and turns the address off (Zapier answers this when a Zap is deleted).
- The operator sees the last 50 events per address with their status and can send a failed one
  again. Sent and failed events are kept 30 days.
- In production the address must be `https://` on the public internet (`sources/public-fetch.ts`).

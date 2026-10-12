# Connecting an operator's own system (REST adapter)

Operators that already run their own booking or availability system connect it to the platform
by exposing the small HTTP API below. The platform calls it through `RestProvider`
(`packages/adapters/src/rest.ts`). A working reference implementation lives in
`packages/adapters/src/reference-server.ts` (`createReferenceServer`).

All requests carry `Authorization: Bearer <token>` (the token the operator enters in the platform)
and use JSON. Dates are ISO 8601 with an offset. Money is in minor units (bani, cents), VAT included.

| Method | Path                                    | Request                                                  | Response                                                                              |
| ------ | --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/products`                             |                                                          | `[{ id, name, durationMinutes, prices: [{ code, label, amountMinor, taxRateBps }] }]` |
| GET    | `/products/{id}/availability?from=&to=` |                                                          | `[{ id, startsAt, endsAt, capacity, available }]`                                     |
| POST   | `/holds`                                | `{ productId, slotId, startsAt, seats, ttlSeconds }`     | `201 { id, expiresAt }`, or `409 { available }` when sold out                         |
| POST   | `/holds/{id}/confirm`                   | `{ reference, customer: { name, email, phone }, seats }` | `{ bookingRef }`, or `410` if the hold expired                                        |
| DELETE | `/holds/{id}`                           |                                                          | `204` (also when already released)                                                    |
| POST   | `/bookings/{bookingRef}/cancel`         |                                                          | `204` (also when already cancelled)                                                   |

Rules the platform relies on:

- A hold blocks the seats until `expiresAt`; after that the operator's system frees them on its own.
- Confirming the same hold twice returns the same `bookingRef`.
- `available` never exceeds `capacity` and already excludes seats held or booked elsewhere.
- Answers come within 8 seconds; otherwise the platform shows the departure as unavailable.

## How the platform uses it

The operator connects their system once (`POST /operator/sources` with a name, the base URL and
the token). The platform checks that `GET /products` answers, stores the token encrypted and
imports the trips, prices and the next 60 days of departures. After that:

- Departures are re-read every 10 minutes, and at most once a minute when someone looks at a
  trip's calendar. If the system does not answer, the last known availability is shown.
- A booking first holds the seats in the operator's system (`POST /holds`). If it answers `409`,
  the customer is told how many seats are left; nothing is created on the platform.
- Once the customer pays (or immediately, for pay-at-boarding bookings made by an affiliate), the
  hold is confirmed (`POST /holds/{id}/confirm`) and the operator's `bookingRef` is shown next to
  the booking. If the payment arrived after the hold expired, the platform holds and confirms
  again; if the departure is full by then, the booking is flagged for the operator to resolve.
  Failed confirmations are retried in the background.
- An unpaid booking that expires or is cancelled releases its hold (`DELETE /holds/{id}`).
- A paid booking cancelled on the platform is cancelled in the operator's system first
  (`POST /bookings/{bookingRef}/cancel`); if that call fails, nothing is cancelled or refunded and
  the operator can try again.
- Prices and departures of imported trips are edited in the operator's system, not here.

In production the base URL must use `https://`. The platform calls only the address the operator
entered; run the API behind an egress proxy if operators must not reach internal addresses.

Operators without a system of their own use the platform's internal calendar instead.

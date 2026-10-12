# Connecting an operator's own system (REST adapter)

Operators that already run their own booking or availability system connect it to the platform
by exposing the small HTTP API below. The platform calls it through `RestProvider`
(`packages/adapters/src/rest.ts`). A working reference implementation lives in
`packages/adapters/src/provider.test.ts` (`referenceServer`).

All requests carry `Authorization: Bearer <token>` (the token the operator enters in the platform)
and use JSON. Dates are ISO 8601 with an offset. Money is in minor units (bani, cents), VAT included.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/products` | | `[{ id, name, durationMinutes, prices: [{ code, label, amountMinor, taxRateBps }] }]` |
| GET | `/products/{id}/availability?from=&to=` | | `[{ id, startsAt, endsAt, capacity, available }]` |
| POST | `/holds` | `{ productId, slotId, startsAt, seats, ttlSeconds }` | `201 { id, expiresAt }`, or `409 { available }` when sold out |
| POST | `/holds/{id}/confirm` | `{ reference, customer: { name, email, phone }, seats }` | `{ bookingRef }`, or `410` if the hold expired |
| DELETE | `/holds/{id}` | | `204` (also when already released) |
| POST | `/bookings/{bookingRef}/cancel` | | `204` (also when already cancelled) |

Rules the platform relies on:

- A hold blocks the seats until `expiresAt`; after that the operator's system frees them on its own.
- Confirming the same hold twice returns the same `bookingRef`.
- `available` never exceeds `capacity` and already excludes seats held or booked elsewhere.
- Answers come within 8 seconds; otherwise the platform shows the departure as unavailable.

Operators without a system of their own use the platform's internal calendar instead.

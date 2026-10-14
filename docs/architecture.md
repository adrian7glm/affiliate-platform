# Structura codului

Un singur API (NestJS) împărțit în module, o bază Postgres, o aplicație web (Next.js) și pachete
comune. Modulele comunică prin servicii exportate sau prin evenimente (outbox), deci oricare poate
deveni mai târziu un serviciu separat.

```
apps/api            API-ul și workerul (același cod, `dist/main.js` și `dist/worker.js`)
apps/web            aplicația web: afiliați, operator, admin, rezervare publică, bilet, scanare
packages/commission motorul de comisioane (fără bază de date, testat separat)
packages/contracts  tipurile comune API ↔ web și evenimentele dintre module
packages/db         schema Postgres (Drizzle), migrările
packages/adapters   conectorii către sistemele de rezervări ale operatorilor
packages/i18n       traducerile (un fișier .json pe limbă)
```

## Cine scrie în ce tabel

Regula: **un modul scrie doar în tabelele lui.** Tabelele altor module se pot citi (rapoarte,
join-uri), dar se modifică prin serviciul modulului care le deține, sau printr-un eveniment.

| Modul (`apps/api/src/…`) | Tabele pe care le scrie                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`               | `users`, `memberships`, `otp_codes`                                                                                                     |
| `platform`               | `tenants` (creare, suspendare, comision platformă), `platform_plans`, `tenant_subscriptions`, `operator_invites`, `contact_requests`    |
| `settings`               | `tenants` (doar setările pe care operatorul și le schimbă singur)                                                                       |
| `affiliates`             | `affiliates`                                                                                                                            |
| `tracking`               | `affiliate_links`, `clicks`                                                                                                             |
| `catalog`                | `products`, `product_prices`, `slots`, `holds`                                                                                          |
| `sources`                | `availability_sources`; plus excursiile importate în tabelele `catalog` (este calea de import a catalogului) și `bookings.external_ref` |
| `booking`                | `bookings`, `booking_items`, `tickets`, `payments`                                                                                      |
| `payments`               | `processed_webhook_events`                                                                                                              |
| `commissions`            | `commission_plans`, `commission_entries`, `payouts`; plus `affiliates.commission_plan_id` când un plan e înlocuit sau retras            |
| `notifications`          | `notifications`                                                                                                                         |
| `outbox`                 | `outbox_events`                                                                                                                         |
| `jobs`                   | `worker_heartbeats`; șterge rândurile vechi (vezi `docs/deploy.md`)                                                                     |
| `i18n`                   | `languages`, `translations`                                                                                                             |
| `analytics`              | nimic (doar citește)                                                                                                                    |
| `audit_log`              | jurnal doar cu adăugare, scris de `booking`, `sources` și `platform`                                                                    |

Excepțiile de mai sus sunt intenționate. Orice altă scriere în tabelul altui modul trebuie mutată
în serviciul proprietarului (ex. rolurile se dau prin `IdentityService.grantRole`).

## O singură definiție pentru „vânzare”

O vânzare este o rezervare plătită și neanulată, numărată în luna plății (fusul orar al
operatorului). Condiția e scrisă o singură dată, în `apps/api/src/common/sales.ts`
(`paidBetween`), și e folosită de pragurile de comision, raportul lunar și panourile operatorului.

## Comisioane

`apps/api/src/commissions/`:

- `commission-plans.service.ts`: planurile (fix sau progresiv) și ce plan are fiecare afiliat;
- `ledger.service.ts`: registrul (vânzare, anulare, aprobare după excursie), doar cu adăugare;
- `affiliate-earnings.service.ts`: ce vede afiliatul (luna curentă, nivel, istoric);
- `payouts.service.ts`: raportul operatorului, închiderea lunii, plata afiliaților.

## Lucrul din fundal

Joburile sunt în `apps/api/src/jobs/` (lista și intervalele în `jobs.ts`). Rulează în procesul
`worker` (sau în API, local, cu `WORKER_ENABLED=true`). Fiecare job lasă un „semn de viață” în
`worker_heartbeats`, citit de `/health/worker` și de pagina `/admin/system`.

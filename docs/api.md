# HTTP API

Base URL: `API_URL` (local: `http://localhost:4000`). Request and response types live in
`packages/contracts/src/api.ts`; bodies are validated with the zod schemas exported there.

Authentication: `Authorization: Bearer <token>` from `POST /auth/otp/verify`.
Operator and affiliate routes also need `X-Tenant-Id: <tenant id>` (the user must have a
membership in that tenant with the right role).

Errors: `{ statusCode, error, message, details? }`.

## Auth

| Method | Path                | Body               | Response                                  |
| ------ | ------------------- | ------------------ | ----------------------------------------- |
| POST   | `/auth/otp/request` | `RequestOtpBody`   | 204 (always, to avoid revealing accounts) |
| POST   | `/auth/otp/verify`  | `VerifyOtpBody`    | `SessionDto`                              |
| GET    | `/me`               |                    | `MeDto`                                   |
| GET    | `/invites/:token`   |                    | `InvitePreviewDto` (public)               |
| POST   | `/invites/accept`   | `AcceptInviteBody` | `MeDto`                                   |

## Affiliate (role `affiliate`)

| Method | Path                            | Body / query                     | Response            |
| ------ | ------------------------------- | -------------------------------- | ------------------- |
| GET    | `/affiliate/home`               |                                  | `AffiliateHomeDto`  |
| GET    | `/affiliate/earnings`           | `?period=YYYY-MM`                | `EarningsDto`       |
| GET    | `/affiliate/links`              |                                  | `LinkDto[]`         |
| POST   | `/affiliate/links`              | `CreateLinkBody`                 | `LinkDto`           |
| GET    | `/affiliate/products`           |                                  | `ProductDto[]`      |
| GET    | `/affiliate/products/:id/slots` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` | `SlotDto[]`         |
| POST   | `/affiliate/bookings`           | `AssistedBookingBody`            | `CheckoutResultDto` |
| GET    | `/affiliate/bookings`           |                                  | `BookingDto[]`      |

## Operator (roles `owner`, `staff`)

| Method | Path                                          | Body / query          | Response                            |
| ------ | --------------------------------------------- | --------------------- | ----------------------------------- |
| GET    | `/operator/dashboard`                         |                       | `OperatorDashboardDto`              |
| GET    | `/operator/analytics`                         | `?period=YYYY-MM`     | `OperatorAnalyticsDto`              |
| GET    | `/operator/affiliates`                        |                       | `AffiliateWithStatsDto[]`           |
| POST   | `/operator/affiliates`                        | `InviteAffiliateBody` | `AffiliateDto` (with `inviteUrl`)   |
| PATCH  | `/operator/affiliates/:id`                    | `UpdateAffiliateBody` | `AffiliateDto`                      |
| GET    | `/operator/commission-plans`                  |                       | `CommissionPlanDto[]`               |
| POST   | `/operator/commission-plans`                  | `CreatePlanBody`      | `CommissionPlanDto`                 |
| PUT    | `/operator/commission-plans/:id`              | `UpdatePlanBody`      | `CommissionPlanDto` (new version)   |
| POST   | `/operator/commission-plans/:id/make-default` |                       | `CommissionPlanDto`                 |
| DELETE | `/operator/commission-plans/:id`              |                       | `ArchivePlanResultDto`              |
| GET    | `/operator/products`                          |                       | `ProductDto[]`                      |
| POST   | `/operator/products`                          | `CreateProductBody`   | `ProductDto`                        |
| PATCH  | `/operator/products/:id`                      | `UpdateProductBody`   | `ProductDto`                        |
| GET    | `/operator/products/:id/slots`                | `?from&to`            | `OperatorSlotDto[]`                 |
| POST   | `/operator/products/:id/slots`                | `CreateSlotsBody`     | `{ created: number }`               |
| PATCH  | `/operator/products/:id/slots`                | `UpdateSlotsBody`     | `UpdateSlotsResultDto`              |
| POST   | `/operator/products/:id/slots/delete`         | `DeleteSlotsBody`     | `DeleteSlotsResultDto`              |
| GET    | `/operator/settings`                          |                       | `OperatorSettingsDto`               |
| PATCH  | `/operator/settings` (owner)                  | `UpdateSettingsBody`  | `OperatorSettingsDto`               |
| GET    | `/operator/bookings`                          | `?from&to`            | `BookingDto[]`                      |
| POST   | `/operator/bookings/:id/cancel`               | `CancelBookingBody`   | `BookingDto`                        |
| POST   | `/operator/tickets/check-in`                  | `CheckInBody`         | `CheckInResultDto` (also `scanner`) |
| GET    | `/operator/scanners`                          |                       | `ScannerAccountDto[]`               |
| POST   | `/operator/scanners`                          | `AddScannerBody`      | `ScannerAccountDto`                 |
| DELETE | `/operator/scanners/:userId`                  |                       | 204                                 |
| GET    | `/operator/commissions/report`                | `?period=YYYY-MM`     | `CommissionReportDto`               |
| POST   | `/operator/payouts/close-period`              | `ClosePeriodBody`     | `ClosePeriodResultDto`              |
| GET    | `/operator/payouts`                           | `?period=YYYY-MM`     | `PayoutDto[]`                       |
| POST   | `/operator/payouts/:id/mark-paid`             |                       | `PayoutDto`                         |
| GET    | `/operator/sources`                           |                       | `SourceDto[]`                       |
| POST   | `/operator/sources` (owner)                   | `ConnectSourceBody`   | `SourceDto`                         |
| POST   | `/operator/sources/:id/sync`                  |                       | `SyncResultDto`                     |

## Boarding scanner (roles `scanner`, `owner`, `staff`)

A `scanner` account sees nothing else: besides this route it can only call
`POST /operator/tickets/check-in`.

| Method | Path               | Response            |
| ------ | ------------------ | ------------------- |
| GET    | `/scanner/context` | `ScannerContextDto` |

## Public (no authentication)

| Method | Path                                                | Body / query         | Response                                    |
| ------ | --------------------------------------------------- | -------------------- | ------------------------------------------- |
| POST   | `/public/links/:code/click`                         | `RecordClickBody`    | `ClickResultDto`                            |
| GET    | `/public/tenants/:slug`                             |                      | `PublicTenantDto`                           |
| GET    | `/public/tenants/:slug/products/:productSlug`       |                      | `ProductDto`                                |
| GET    | `/public/tenants/:slug/products/:productSlug/slots` | `?from&to`           | `SlotDto[]`                                 |
| POST   | `/public/tenants/:slug/checkout`                    | `PublicCheckoutBody` | `CheckoutResultDto`                         |
| GET    | `/public/tickets/:bookingId`                        | `?k=<ticket key>`    | `TicketDto`                                 |
| GET    | `/public/tickets/:bookingId/pdf`                    | `?k&lang&download=1` | PDF ticket (409 if the ticket is not valid) |
| POST   | `/public/dev-payments/:bookingId/succeed`           | `?k=<ticket key>`    | 204, only with `PAYMENTS_PROVIDER=fake`     |
| POST   | `/webhooks/stripe`                                  | Stripe event         | 200                                         |

## Platform owner, operator signup and billing

Types in `packages/contracts/src/platform.ts`. Fees are basis points (300 = 3%).

Operator signup (`SELF_SIGNUP=false` allows only invitations):

| Method | Path                     | Body / query       | Response                                      |
| ------ | ------------------------ | ------------------ | --------------------------------------------- |
| GET    | `/signup/options`        |                    | `SignupOptionsDto` (public)                   |
| GET    | `/signup/slug`           | `?slug`            | `SlugCheckDto` (public)                       |
| GET    | `/signup/invites/:token` |                    | `OperatorInvitePreviewDto` (public)           |
| POST   | `/signup/tenants`        | `CreateTenantBody` | `CreateTenantResultDto`; signed in, no tenant |

Operator (roles `owner`, `staff`; changing the plan is `owner` only):

| Method | Path                         | Body                    | Response             |
| ------ | ---------------------------- | ----------------------- | -------------------- |
| GET    | `/operator/onboarding`       |                         | `OnboardingDto`      |
| GET    | `/operator/billing`          |                         | `OperatorBillingDto` |
| POST   | `/operator/billing/checkout` | `StartSubscriptionBody` | `BillingRedirectDto` |
| POST   | `/operator/billing/portal`   |                         | `BillingRedirectDto` |

Platform admin (users with `isPlatformAdmin`, set at sign-in for `PLATFORM_ADMIN_EMAILS`):

| Method | Path                         | Body                       | Response               |
| ------ | ---------------------------- | -------------------------- | ---------------------- |
| GET    | `/admin/overview`            | `?period=YYYY-MM`          | `AdminOverviewDto`     |
| GET    | `/admin/tenants/:id`         |                            | `AdminTenantDetailDto` |
| PATCH  | `/admin/tenants/:id/status`  | `UpdateTenantStatusBody`   | `AdminTenantDetailDto` |
| PATCH  | `/admin/tenants/:id/billing` | `UpdateTenantBillingBody`  | `SubscriptionDto`      |
| GET    | `/admin/plans`               |                            | `PlatformPlanDto[]`    |
| POST   | `/admin/plans`               | `CreatePlatformPlanBody`   | `PlatformPlanDto`      |
| PATCH  | `/admin/plans/:id`           | `UpdatePlatformPlanBody`   | `PlatformPlanDto`      |
| GET    | `/admin/invites`             |                            | `OperatorInviteDto[]`  |
| POST   | `/admin/invites`             | `CreateOperatorInviteBody` | `OperatorInviteDto`    |
| POST   | `/admin/invites/:id/revoke`  |                            | `OperatorInviteDto`    |

A suspended operator gets 403 on every operator and affiliate route, and 404 on its public pages.
Stripe Billing (`BILLING_PROVIDER=stripe`) posts subscription events to
`POST /webhooks/stripe/billing`, signed with `STRIPE_BILLING_WEBHOOK_SECRET`.

## Languages and translations

Every request may send `Accept-Language` (the web app sends the page language); error
`message`s come back in that language and also carry their translation key in `code`
(`errors.notFound.product`). Texts live in `packages/i18n/src/locales/<lang>.json`; the platform
admin's changes are layered on top.

| Method | Path                                  | Body / query           | Response                             |
| ------ | ------------------------------------- | ---------------------- | ------------------------------------ |
| GET    | `/i18n/languages`                     |                        | `PublicLanguagesDto` (visible ones)  |
| GET    | `/i18n/messages/:lang`                |                        | `PublicMessagesDto` (admin's texts)  |
| GET    | `/admin/i18n/languages` (admin)       |                        | `AdminLanguageDto[]`                 |
| POST   | `/admin/i18n/languages` (admin)       | `CreateLanguageBody`   | `AdminLanguageDto` (hidden at first) |
| PATCH  | `/admin/i18n/languages/:code` (admin) | `UpdateLanguageBody`   | `AdminLanguageDto`                   |
| DELETE | `/admin/i18n/languages/:code` (admin) |                        | 204 (languages added from the admin) |
| GET    | `/admin/i18n/languages/:code/texts`   |                        | `AdminTranslationsDto`               |
| PUT    | `/admin/i18n/languages/:code/texts`   | `SaveTranslationsBody` | `SaveTranslationsResultDto`          |

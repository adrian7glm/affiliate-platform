# HTTP API

Base URL: `API_URL` (local: `http://localhost:4000`). Request and response types live in
`packages/contracts/src/api.ts`; bodies are validated with the zod schemas exported there.

Authentication: `Authorization: Bearer <token>` from `POST /auth/otp/verify`.
Operator and affiliate routes also need `X-Tenant-Id: <tenant id>` (the user must have a
membership in that tenant with the right role).

Errors: `{ statusCode, error, message, details? }`.

## Auth

| Method | Path                | Body               | Response                                                          |
| ------ | ------------------- | ------------------ | ----------------------------------------------------------------- |
| POST   | `/auth/otp/request` | `RequestOtpBody`   | 204 (always, to avoid revealing accounts)                         |
| POST   | `/auth/otp/verify`  | `VerifyOtpBody`    | `SessionDto`, or `MfaChallengeDto` when two-step login is on      |
| POST   | `/auth/mfa/verify`  | `VerifyMfaBody`    | `SessionDto` (code from the authenticator app or a recovery code) |
| GET    | `/me`               |                    | `MeDto`                                                           |
| GET    | `/invites/:token`   |                    | `InvitePreviewDto` (public)                                       |
| POST   | `/invites/accept`   | `AcceptInviteBody` | `MeDto`                                                           |

Login codes, checkouts, the contact form and second-step codes are rate limited per client IP
(429 with `Retry-After`). Wrong second-step codes lock the second step for 15 minutes after 5 in
a row. Session tokens carry the user's session version: signing out other devices or turning on
two-step login invalidates every older token.

## Own account (any signed-in user, no `X-Tenant-Id`)

| Method | Path                                | Body                       | Response                           |
| ------ | ----------------------------------- | -------------------------- | ---------------------------------- |
| GET    | `/account/security`                 |                            | `AccountSecurityDto`               |
| POST   | `/account/2fa/setup`                |                            | `TwoFactorSetupDto` (secret + QR)  |
| POST   | `/account/2fa/enable`               | `TwoFactorCodeBody`        | `TwoFactorEnabledDto` (new token)  |
| POST   | `/account/2fa/disable`              | `TwoFactorCodeBody`        | `MeDto`                            |
| POST   | `/account/2fa/recovery-codes`       | `TwoFactorCodeBody`        | `RecoveryCodesDto`                 |
| POST   | `/account/sessions/sign-out-others` |                            | `NewSessionTokenDto`               |
| POST   | `/account/contact/request`          | `ContactChangeRequestBody` | 204 (code sent to the new contact) |
| POST   | `/account/contact/verify`           | `ContactChangeVerifyBody`  | `MeDto`                            |

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

Commission plan changes, closing a payout period and marking payouts paid are `owner` only;
staff can invite and edit affiliates but not set their commission.

| Method | Path                                          | Body / query           | Response                            |
| ------ | --------------------------------------------- | ---------------------- | ----------------------------------- |
| GET    | `/operator/dashboard`                         |                        | `OperatorDashboardDto`              |
| GET    | `/operator/analytics`                         | `?period=YYYY-MM`      | `OperatorAnalyticsDto`              |
| GET    | `/operator/affiliates`                        |                        | `AffiliateWithStatsDto[]`           |
| POST   | `/operator/affiliates`                        | `InviteAffiliateBody`  | `AffiliateDto` (with `inviteUrl`)   |
| PATCH  | `/operator/affiliates/:id`                    | `UpdateAffiliateBody`  | `AffiliateDto`                      |
| GET    | `/operator/commission-plans`                  |                        | `CommissionPlanDto[]`               |
| POST   | `/operator/commission-plans`                  | `CreatePlanBody`       | `CommissionPlanDto`                 |
| PUT    | `/operator/commission-plans/:id`              | `UpdatePlanBody`       | `CommissionPlanDto` (new version)   |
| POST   | `/operator/commission-plans/:id/make-default` |                        | `CommissionPlanDto`                 |
| DELETE | `/operator/commission-plans/:id`              |                        | `ArchivePlanResultDto`              |
| GET    | `/operator/products`                          |                        | `ProductDto[]`                      |
| POST   | `/operator/products`                          | `CreateProductBody`    | `ProductDto`                        |
| PATCH  | `/operator/products/:id`                      | `UpdateProductBody`    | `ProductDto`                        |
| GET    | `/operator/products/:id/slots`                | `?from&to`             | `OperatorSlotDto[]`                 |
| POST   | `/operator/products/:id/slots`                | `CreateSlotsBody`      | `{ created: number }`               |
| PATCH  | `/operator/products/:id/slots`                | `UpdateSlotsBody`      | `UpdateSlotsResultDto`              |
| POST   | `/operator/products/:id/slots/delete`         | `DeleteSlotsBody`      | `DeleteSlotsResultDto`              |
| POST   | `/operator/products/:id/slots/cancel`         | `CancelDeparturesBody` | `CancelDeparturesResultDto`         |
| GET    | `/operator/settings`                          |                        | `OperatorSettingsDto`               |
| PATCH  | `/operator/settings` (owner)                  | `UpdateSettingsBody`   | `OperatorSettingsDto`               |
| GET    | `/operator/bookings`                          | `?from&to`             | `BookingDto[]`                      |
| POST   | `/operator/bookings/:id/cancel`               | `CancelBookingBody`    | `BookingDto`                        |
| POST   | `/operator/tickets/check-in`                  | `CheckInBody`          | `CheckInResultDto` (also `scanner`) |
| GET    | `/operator/scanners`                          |                        | `ScannerAccountDto[]`               |
| POST   | `/operator/scanners`                          | `AddScannerBody`       | `ScannerAccountDto`                 |
| DELETE | `/operator/scanners/:userId`                  |                        | 204                                 |
| GET    | `/operator/commissions/report`                | `?period=YYYY-MM`      | `CommissionReportDto`               |
| POST   | `/operator/payouts/close-period`              | `ClosePeriodBody`      | `ClosePeriodResultDto`              |
| GET    | `/operator/payouts`                           | `?period=YYYY-MM`      | `PayoutDto[]`                       |
| POST   | `/operator/payouts/:id/mark-paid`             |                        | `PayoutDto`                         |
| GET    | `/operator/sources`                           |                        | `SourceDto[]`                       |
| POST   | `/operator/sources` (owner)                   | `ConnectSourceBody`    | `SourceDto`                         |
| POST   | `/operator/sources/:id/sync`                  |                        | `SyncResultDto`                     |
| GET    | `/operator/calendar-feed`                     |                        | `CalendarFeedDto`                   |
| POST   | `/operator/calendar-feed/reset` (owner)       |                        | `CalendarFeedDto`                   |

## Webhooks (role `owner`)

Addresses in the operator's other software that are told about bookings; payload, signature and
retries in [webhooks.md](webhooks.md). Types in `packages/contracts/src/integrations.ts`.

| Method | Path                                                  | Body                | Response               |
| ------ | ----------------------------------------------------- | ------------------- | ---------------------- |
| GET    | `/operator/webhooks`                                  |                     | `WebhookEndpointDto[]` |
| POST   | `/operator/webhooks`                                  | `CreateWebhookBody` | `CreatedWebhookDto`    |
| PATCH  | `/operator/webhooks/:id`                              | `UpdateWebhookBody` | `WebhookEndpointDto`   |
| DELETE | `/operator/webhooks/:id`                              |                     | 204                    |
| GET    | `/operator/webhooks/:id/secret`                       |                     | `WebhookSecretDto`     |
| POST   | `/operator/webhooks/:id/test`                         |                     | `WebhookTestResultDto` |
| GET    | `/operator/webhooks/:id/deliveries`                   |                     | `WebhookDeliveryDto[]` |
| POST   | `/operator/webhooks/:id/deliveries/:deliveryId/retry` |                     | `WebhookDeliveryDto`   |

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
| GET    | `/public/tickets/:bookingId/calendar.ics`           | `?k&lang`            | iCalendar event (409 if not valid)          |
| POST   | `/public/contact`                                   | `ContactRequestBody` | 204 (429 after 3 per hour per email)        |
| GET    | `/public/calendar/:token.ics`                       | `?lang`              | Departures calendar feed (iCalendar)        |
| POST   | `/public/dev-payments/:bookingId/succeed`           | `?k=<ticket key>`    | 204, only with `PAYMENTS_PROVIDER=fake`     |
| POST   | `/webhooks/stripe`                                  | Stripe event         | 200                                         |

`/webhooks/stripe` handles `checkout.session.completed` and
`checkout.session.async_payment_succeeded` (confirms the booking once the session is paid) and
`charge.refunded` (a full refund made in the Stripe dashboard cancels the booking, voids its ticket
and reverses the commission; a partial one is only recorded). Events for payments that are not
bookings of the platform are acknowledged and ignored.

`PublicCheckoutBody.acceptTerms` must be `true` (the customer ticked the booking terms and
privacy policy); the time is stored on the booking. Cancelling departures closes them, then
cancels and refunds every booking on them and tells each customer why; departures that already
left are refused (409). A payment that arrives for an already cancelled booking is refunded.

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

| Method | Path                                  | Body                       | Response                |
| ------ | ------------------------------------- | -------------------------- | ----------------------- |
| GET    | `/admin/overview`                     | `?period=YYYY-MM`          | `AdminOverviewDto`      |
| GET    | `/admin/tenants/:id`                  |                            | `AdminTenantDetailDto`  |
| PATCH  | `/admin/tenants/:id/status`           | `UpdateTenantStatusBody`   | `AdminTenantDetailDto`  |
| PATCH  | `/admin/tenants/:id/billing`          | `UpdateTenantBillingBody`  | `SubscriptionDto`       |
| GET    | `/admin/plans`                        |                            | `PlatformPlanDto[]`     |
| POST   | `/admin/plans`                        | `CreatePlatformPlanBody`   | `PlatformPlanDto`       |
| PATCH  | `/admin/plans/:id`                    | `UpdatePlatformPlanBody`   | `PlatformPlanDto`       |
| GET    | `/admin/invites`                      |                            | `OperatorInviteDto[]`   |
| POST   | `/admin/invites`                      | `CreateOperatorInviteBody` | `OperatorInviteDto`     |
| POST   | `/admin/invites/:id/revoke`           |                            | `OperatorInviteDto`     |
| GET    | `/admin/contact-requests`             |                            | `ContactRequestDto[]`   |
| POST   | `/admin/contact-requests/:id/handled` | `SetContactHandledBody`    | `ContactRequestDto`     |
| GET    | `/admin/accounts`                     | `?contact=` phone or email | `AdminAccountLookupDto` |
| POST   | `/admin/accounts/:id/2fa/reset`       |                            | `AdminAccountDto`       |
| POST   | `/admin/accounts/:id/sign-out`        |                            | `AdminAccountDto`       |

Resetting two-step login (for someone who lost the phone and the recovery codes) also signs the
account out everywhere; both actions go to the audit log and the reset sends a `security_alert`.

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

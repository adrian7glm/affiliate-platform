import type {
  AccountSecurityDto,
  ContactChangeRequestBody,
  ContactChangeVerifyBody,
  NewSessionTokenDto,
  RecoveryCodesDto,
  TwoFactorEnabledDto,
  TwoFactorSetupDto,
  VerifyMfaBody,
  VerifyOtpResultDto,
  ArchivePlanResultDto,
  CalendarFeedDto,
  CreateWebhookBody,
  CreatedWebhookDto,
  UpdateWebhookBody,
  WebhookDeliveryDto,
  WebhookEndpointDto,
  WebhookSecretDto,
  WebhookTestResultDto,
  DeleteSlotsResultDto,
  DepartureDayDto,
  DeparturePassengersDto,
  OperatorSettingsDto,
  OperatorSlotDto,
  UpdatePlanBody,
  UpdateProductBody,
  UpdateSettingsBody,
  UpdateSlotsBody,
  UpdateSlotsResultDto,
  AddScannerBody,
  ScannerAccountDto,
  ScannerContextDto,
  ConnectSourceBody,
  ContactRequestBody,
  PublicCheckoutBody,
  SourceDto,
  SyncResultDto,
  AcceptInviteBody,
  AffiliateDto,
  AffiliateHomeDto,
  AffiliateWithStatsDto,
  AssistedBookingBody,
  BookingDto,
  CancelBookingBody,
  CancelDeparturesBody,
  CancelDeparturesResultDto,
  CheckInBody,
  CheckInResultDto,
  CheckoutResultDto,
  ClosePeriodBody,
  ClosePeriodResultDto,
  CommissionPlanDto,
  CommissionReportDto,
  CreateDiscountCodeBody,
  CreateLinkBody,
  DiscountCodeDto,
  DiscountPreviewDto,
  UpdateDiscountCodeBody,
  CreatePlanBody,
  CreateProductBody,
  CreateSlotsBody,
  EarningsDto,
  InviteAffiliateBody,
  InvitePreviewDto,
  LinkDto,
  MeDto,
  OperatorAnalyticsDto,
  OperatorDashboardDto,
  PayoutDto,
  ProductDto,
  PublicTenantDto,
  RequestOtpBody,
  SessionDto,
  SlotDto,
  TicketDto,
  UpdateAffiliateBody,
  VerifyOtpBody,
} from '@ap/contracts';
import { API_URL, apiFetch, buildUrl, type RequestOptions } from './api';

/**
 * One typed function per endpoint in docs/api.md. Pages call these instead of building URLs.
 */

/** `lang`: the language of error messages and, on public pages, of the operator's trip texts. */
type Opts = Pick<RequestOptions, 'signal' | 'baseUrl' | 'lang'>;
const enc = encodeURIComponent;

export interface DateRange {
  from?: string;
  to?: string;
}

export const authApi = {
  requestOtp: (body: RequestOtpBody, o?: Opts) =>
    apiFetch<void>('/auth/otp/request', { ...o, method: 'POST', body, auth: false }),
  verifyOtp: (body: VerifyOtpBody, o?: Opts) =>
    apiFetch<VerifyOtpResultDto>('/auth/otp/verify', { ...o, method: 'POST', body, auth: false }),
  verifyMfa: (body: VerifyMfaBody, o?: Opts) =>
    apiFetch<SessionDto>('/auth/mfa/verify', { ...o, method: 'POST', body, auth: false }),
  me: (o?: Opts) => apiFetch<MeDto>('/me', { ...o, tenant: false }),
  invitePreview: (token: string, o?: Opts) =>
    apiFetch<InvitePreviewDto>(`/invites/${enc(token)}`, { ...o, auth: false }),
  acceptInvite: (body: AcceptInviteBody, o?: Opts) =>
    apiFetch<MeDto>('/invites/accept', { ...o, method: 'POST', body, tenant: false }),
};

/** The signed-in person's own account (any role): contact details, two-step login, devices. */
export const accountApi = {
  security: (o?: Opts) =>
    apiFetch<AccountSecurityDto>('/account/security', { ...o, tenant: false }),
  startTwoFactor: (o?: Opts) =>
    apiFetch<TwoFactorSetupDto>('/account/2fa/setup', { ...o, method: 'POST', tenant: false }),
  enableTwoFactor: (code: string, o?: Opts) =>
    apiFetch<TwoFactorEnabledDto>('/account/2fa/enable', {
      ...o,
      method: 'POST',
      body: { code },
      tenant: false,
    }),
  disableTwoFactor: (code: string, o?: Opts) =>
    apiFetch<MeDto>('/account/2fa/disable', {
      ...o,
      method: 'POST',
      body: { code },
      tenant: false,
    }),
  newRecoveryCodes: (code: string, o?: Opts) =>
    apiFetch<RecoveryCodesDto>('/account/2fa/recovery-codes', {
      ...o,
      method: 'POST',
      body: { code },
      tenant: false,
    }),
  signOutOtherDevices: (o?: Opts) =>
    apiFetch<NewSessionTokenDto>('/account/sessions/sign-out-others', {
      ...o,
      method: 'POST',
      tenant: false,
    }),
  requestContactChange: (body: ContactChangeRequestBody, o?: Opts) =>
    apiFetch<void>('/account/contact/request', { ...o, method: 'POST', body, tenant: false }),
  confirmContactChange: (body: ContactChangeVerifyBody, o?: Opts) =>
    apiFetch<MeDto>('/account/contact/verify', { ...o, method: 'POST', body, tenant: false }),
};

export const affiliateApi = {
  home: (o?: Opts) => apiFetch<AffiliateHomeDto>('/affiliate/home', o),
  earnings: (period: string, o?: Opts) =>
    apiFetch<EarningsDto>('/affiliate/earnings', { ...o, query: { period } }),
  links: (o?: Opts) => apiFetch<LinkDto[]>('/affiliate/links', o),
  createLink: (body: CreateLinkBody, o?: Opts) =>
    apiFetch<LinkDto>('/affiliate/links', { ...o, method: 'POST', body }),
  products: (o?: Opts) => apiFetch<ProductDto[]>('/affiliate/products', o),
  slots: (productId: string, range: DateRange, o?: Opts) =>
    apiFetch<SlotDto[]>(`/affiliate/products/${enc(productId)}/slots`, {
      ...o,
      query: { ...range },
    }),
  createBooking: (body: AssistedBookingBody, o?: Opts) =>
    apiFetch<CheckoutResultDto>('/affiliate/bookings', { ...o, method: 'POST', body }),
  bookings: (o?: Opts) => apiFetch<BookingDto[]>('/affiliate/bookings', o),
  /** The affiliate's own discount codes, to give to their guests. */
  discountCodes: (o?: Opts) => apiFetch<DiscountCodeDto[]>('/affiliate/discount-codes', o),
};

export const operatorApi = {
  dashboard: (o?: Opts) => apiFetch<OperatorDashboardDto>('/operator/dashboard', o),
  analytics: (period: string, o?: Opts) =>
    apiFetch<OperatorAnalyticsDto>('/operator/analytics', { ...o, query: { period } }),
  affiliates: (o?: Opts) => apiFetch<AffiliateWithStatsDto[]>('/operator/affiliates', o),
  inviteAffiliate: (body: InviteAffiliateBody, o?: Opts) =>
    apiFetch<AffiliateDto>('/operator/affiliates', { ...o, method: 'POST', body }),
  updateAffiliate: (id: string, body: UpdateAffiliateBody, o?: Opts) =>
    apiFetch<AffiliateDto>(`/operator/affiliates/${enc(id)}`, { ...o, method: 'PATCH', body }),
  plans: (o?: Opts) => apiFetch<CommissionPlanDto[]>('/operator/commission-plans', o),
  createPlan: (body: CreatePlanBody, o?: Opts) =>
    apiFetch<CommissionPlanDto>('/operator/commission-plans', { ...o, method: 'POST', body }),
  updatePlan: (id: string, body: UpdatePlanBody, o?: Opts) =>
    apiFetch<CommissionPlanDto>(`/operator/commission-plans/${enc(id)}`, {
      ...o,
      method: 'PUT',
      body,
    }),
  makeDefaultPlan: (id: string, o?: Opts) =>
    apiFetch<CommissionPlanDto>(`/operator/commission-plans/${enc(id)}/make-default`, {
      ...o,
      method: 'POST',
    }),
  archivePlan: (id: string, o?: Opts) =>
    apiFetch<ArchivePlanResultDto>(`/operator/commission-plans/${enc(id)}`, {
      ...o,
      method: 'DELETE',
    }),
  products: (o?: Opts) => apiFetch<ProductDto[]>('/operator/products', o),
  createProduct: (body: CreateProductBody, o?: Opts) =>
    apiFetch<ProductDto>('/operator/products', { ...o, method: 'POST', body }),
  updateProduct: (id: string, body: UpdateProductBody, o?: Opts) =>
    apiFetch<ProductDto>(`/operator/products/${enc(id)}`, { ...o, method: 'PATCH', body }),
  slots: (productId: string, range: DateRange, o?: Opts) =>
    apiFetch<OperatorSlotDto[]>(`/operator/products/${enc(productId)}/slots`, {
      ...o,
      query: { ...range },
    }),
  createSlots: (productId: string, body: CreateSlotsBody, o?: Opts) =>
    apiFetch<{ created: number }>(`/operator/products/${enc(productId)}/slots`, {
      ...o,
      method: 'POST',
      body,
    }),
  updateSlots: (productId: string, body: UpdateSlotsBody, o?: Opts) =>
    apiFetch<UpdateSlotsResultDto>(`/operator/products/${enc(productId)}/slots`, {
      ...o,
      method: 'PATCH',
      body,
    }),
  cancelDepartures: (productId: string, body: CancelDeparturesBody, o?: Opts) =>
    apiFetch<CancelDeparturesResultDto>(`/operator/products/${enc(productId)}/slots/cancel`, {
      ...o,
      method: 'POST',
      body,
    }),
  deleteSlots: (productId: string, slotIds: string[], o?: Opts) =>
    apiFetch<DeleteSlotsResultDto>(`/operator/products/${enc(productId)}/slots/delete`, {
      ...o,
      method: 'POST',
      body: { slotIds },
    }),
  settings: (o?: Opts) => apiFetch<OperatorSettingsDto>('/operator/settings', o),
  updateSettings: (body: UpdateSettingsBody, o?: Opts) =>
    apiFetch<OperatorSettingsDto>('/operator/settings', { ...o, method: 'PATCH', body }),
  bookings: (range: DateRange, o?: Opts) =>
    apiFetch<BookingDto[]>('/operator/bookings', { ...o, query: { ...range } }),
  cancelBooking: (id: string, body: CancelBookingBody, o?: Opts) =>
    apiFetch<BookingDto>(`/operator/bookings/${enc(id)}/cancel`, { ...o, method: 'POST', body }),
  checkIn: (body: CheckInBody, o?: Opts) =>
    apiFetch<CheckInResultDto>('/operator/tickets/check-in', { ...o, method: 'POST', body }),
  /** Boards a passenger from the list, without scanning their ticket. */
  board: (bookingId: string, o?: Opts) =>
    apiFetch<CheckInResultDto>(`/operator/bookings/${enc(bookingId)}/board`, {
      ...o,
      method: 'POST',
    }),
  departures: (date: string, o?: Opts) =>
    apiFetch<DepartureDayDto>('/operator/departures', { ...o, query: { date } }),
  passengers: (slotId: string, o?: Opts) =>
    apiFetch<DeparturePassengersDto>(`/operator/departures/${enc(slotId)}/passengers`, o),
  commissionReport: (period: string, o?: Opts) =>
    apiFetch<CommissionReportDto>('/operator/commissions/report', { ...o, query: { period } }),
  closePeriod: (body: ClosePeriodBody, o?: Opts) =>
    apiFetch<ClosePeriodResultDto>('/operator/payouts/close-period', {
      ...o,
      method: 'POST',
      body,
    }),
  payouts: (period: string, o?: Opts) =>
    apiFetch<PayoutDto[]>('/operator/payouts', { ...o, query: { period } }),
  markPayoutPaid: (id: string, o?: Opts) =>
    apiFetch<PayoutDto>(`/operator/payouts/${enc(id)}/mark-paid`, { ...o, method: 'POST' }),
  sources: (o?: Opts) => apiFetch<SourceDto[]>('/operator/sources', o),
  connectSource: (body: ConnectSourceBody, o?: Opts) =>
    apiFetch<SourceDto>('/operator/sources', { ...o, method: 'POST', body }),
  syncSource: (id: string, o?: Opts) =>
    apiFetch<SyncResultDto>(`/operator/sources/${enc(id)}/sync`, { ...o, method: 'POST' }),
  webhooks: (o?: Opts) => apiFetch<WebhookEndpointDto[]>('/operator/webhooks', o),
  createWebhook: (body: CreateWebhookBody, o?: Opts) =>
    apiFetch<CreatedWebhookDto>('/operator/webhooks', { ...o, method: 'POST', body }),
  updateWebhook: (id: string, body: UpdateWebhookBody, o?: Opts) =>
    apiFetch<WebhookEndpointDto>(`/operator/webhooks/${enc(id)}`, { ...o, method: 'PATCH', body }),
  deleteWebhook: (id: string, o?: Opts) =>
    apiFetch<void>(`/operator/webhooks/${enc(id)}`, { ...o, method: 'DELETE' }),
  webhookSecret: (id: string, o?: Opts) =>
    apiFetch<WebhookSecretDto>(`/operator/webhooks/${enc(id)}/secret`, o),
  testWebhook: (id: string, o?: Opts) =>
    apiFetch<WebhookTestResultDto>(`/operator/webhooks/${enc(id)}/test`, { ...o, method: 'POST' }),
  webhookDeliveries: (id: string, o?: Opts) =>
    apiFetch<WebhookDeliveryDto[]>(`/operator/webhooks/${enc(id)}/deliveries`, o),
  retryWebhookDelivery: (id: string, deliveryId: string, o?: Opts) =>
    apiFetch<WebhookDeliveryDto>(
      `/operator/webhooks/${enc(id)}/deliveries/${enc(deliveryId)}/retry`,
      { ...o, method: 'POST' },
    ),
  calendarFeed: (o?: Opts) => apiFetch<CalendarFeedDto>('/operator/calendar-feed', o),
  resetCalendarFeed: (o?: Opts) =>
    apiFetch<CalendarFeedDto>('/operator/calendar-feed/reset', { ...o, method: 'POST' }),
  scanners: (o?: Opts) => apiFetch<ScannerAccountDto[]>('/operator/scanners', o),
  addScanner: (body: AddScannerBody, o?: Opts) =>
    apiFetch<ScannerAccountDto>('/operator/scanners', { ...o, method: 'POST', body }),
  removeScanner: (userId: string, o?: Opts) =>
    apiFetch<void>(`/operator/scanners/${enc(userId)}`, { ...o, method: 'DELETE' }),
  discountCodes: (o?: Opts) => apiFetch<DiscountCodeDto[]>('/operator/discount-codes', o),
  createDiscountCode: (body: CreateDiscountCodeBody, o?: Opts) =>
    apiFetch<DiscountCodeDto>('/operator/discount-codes', { ...o, method: 'POST', body }),
  updateDiscountCode: (id: string, body: UpdateDiscountCodeBody, o?: Opts) =>
    apiFetch<DiscountCodeDto>(`/operator/discount-codes/${enc(id)}`, {
      ...o,
      method: 'PATCH',
      body,
    }),
};

/** The boarding scanner app (scanner accounts and operator staff). */
export const scannerApi = {
  context: (o?: Opts) => apiFetch<ScannerContextDto>('/scanner/context', o),
};

export const publicApi = {
  tenant: (slug: string, o?: Opts) =>
    apiFetch<PublicTenantDto>(`/public/tenants/${enc(slug)}`, { ...o, auth: false }),
  product: (slug: string, productSlug: string, o?: Opts) =>
    apiFetch<ProductDto>(`/public/tenants/${enc(slug)}/products/${enc(productSlug)}`, {
      ...o,
      auth: false,
    }),
  slots: (slug: string, productSlug: string, range: DateRange, o?: Opts) =>
    apiFetch<SlotDto[]>(`/public/tenants/${enc(slug)}/products/${enc(productSlug)}/slots`, {
      ...o,
      auth: false,
      query: { ...range },
    }),
  checkout: (slug: string, body: PublicCheckoutBody, o?: Opts) =>
    apiFetch<CheckoutResultDto>(`/public/tenants/${enc(slug)}/checkout`, {
      ...o,
      method: 'POST',
      body,
      auth: false,
    }),
  /** The ticket, with the trip in `lang` where the operator translated it. */
  ticket: (bookingId: string, key: string, o?: Opts) =>
    apiFetch<TicketDto>(`/public/tickets/${enc(bookingId)}`, {
      ...o,
      auth: false,
      query: { k: key, lang: o?.lang ?? undefined },
    }),
  /** Direct link to the PDF ticket; `download` asks the browser to save it. */
  ticketPdfUrl: (bookingId: string, key: string, lang: string, download = false) =>
    buildUrl(API_URL, `/public/tickets/${enc(bookingId)}/pdf`, {
      k: key,
      lang,
      download: download ? 1 : undefined,
    }),
  /** The trip as a calendar event (.ics) for Apple Calendar, Outlook and phones. */
  ticketCalendarUrl: (bookingId: string, key: string, lang: string) =>
    buildUrl(API_URL, `/public/tickets/${enc(bookingId)}/calendar.ics`, { k: key, lang }),
  /** Whether a discount code works for a trip today (the error says why not). */
  discount: (slug: string, code: string, productId: string, o?: Opts) =>
    apiFetch<DiscountPreviewDto>(`/public/tenants/${enc(slug)}/discount-codes/${enc(code)}`, {
      ...o,
      auth: false,
      query: { productId },
    }),
  contact: (body: ContactRequestBody, o?: Opts) =>
    apiFetch<void>('/public/contact', { ...o, method: 'POST', body, auth: false }),
  devPaymentSucceed: (bookingId: string, key: string, o?: Opts) =>
    apiFetch<void>(`/public/dev-payments/${enc(bookingId)}/succeed`, {
      ...o,
      method: 'POST',
      auth: false,
      query: { k: key },
    }),
};

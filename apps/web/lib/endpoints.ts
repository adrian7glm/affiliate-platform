import type {
  AuthOptionsDto,
  LoginHandoffBody,
  PasswordLoginBody,
  PasswordResetBody,
  ArchivePlanResultDto,
  DeleteSlotsResultDto,
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
  CreateLinkBody,
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

type Opts = Pick<RequestOptions, 'signal' | 'baseUrl'>;
const enc = encodeURIComponent;

export interface DateRange {
  from?: string;
  to?: string;
}

export const authApi = {
  options: (o?: Opts) => apiFetch<AuthOptionsDto>('/auth/options', { ...o, auth: false }),
  passwordLogin: (body: PasswordLoginBody, o?: Opts) =>
    apiFetch<SessionDto>('/auth/password/login', { ...o, method: 'POST', body, auth: false }),
  passwordReset: (body: PasswordResetBody, o?: Opts) =>
    apiFetch<SessionDto>('/auth/password/reset', { ...o, method: 'POST', body, auth: false }),
  handoff: (body: LoginHandoffBody, o?: Opts) =>
    apiFetch<SessionDto>('/auth/handoff', { ...o, method: 'POST', body, auth: false }),
  /** "Continue with Google" is a plain link: the API sends the browser on to Google. */
  googleStartUrl: (next: string | null) =>
    buildUrl(API_URL, '/auth/google/start', { next: next ?? undefined }),
  requestOtp: (body: RequestOtpBody, o?: Opts) =>
    apiFetch<void>('/auth/otp/request', { ...o, method: 'POST', body, auth: false }),
  verifyOtp: (body: VerifyOtpBody, o?: Opts) =>
    apiFetch<SessionDto>('/auth/otp/verify', { ...o, method: 'POST', body, auth: false }),
  me: (o?: Opts) => apiFetch<MeDto>('/me', { ...o, tenant: false }),
  invitePreview: (token: string, o?: Opts) =>
    apiFetch<InvitePreviewDto>(`/invites/${enc(token)}`, { ...o, auth: false }),
  acceptInvite: (body: AcceptInviteBody, o?: Opts) =>
    apiFetch<MeDto>('/invites/accept', { ...o, method: 'POST', body, tenant: false }),
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
  scanners: (o?: Opts) => apiFetch<ScannerAccountDto[]>('/operator/scanners', o),
  addScanner: (body: AddScannerBody, o?: Opts) =>
    apiFetch<ScannerAccountDto>('/operator/scanners', { ...o, method: 'POST', body }),
  removeScanner: (userId: string, o?: Opts) =>
    apiFetch<void>(`/operator/scanners/${enc(userId)}`, { ...o, method: 'DELETE' }),
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
  ticket: (bookingId: string, key: string, o?: Opts) =>
    apiFetch<TicketDto>(`/public/tickets/${enc(bookingId)}`, {
      ...o,
      auth: false,
      query: { k: key },
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

import type {
  AdminAccountDto,
  AdminAccountLookupDto,
  AdminOverviewDto,
  AdminSystemDto,
  AdminTenantDetailDto,
  BillingRedirectDto,
  ContactRequestDto,
  CreateOperatorInviteBody,
  CreatePlatformPlanBody,
  CreateTenantBody,
  CreateTenantResultDto,
  OnboardingDto,
  OperatorBillingDto,
  OperatorInviteDto,
  OperatorInvitePreviewDto,
  PlatformPlanDto,
  SignupOptionsDto,
  SlugCheckDto,
  StartSubscriptionBody,
  SubscriptionDto,
  UpdatePlatformPlanBody,
  UpdateTenantBillingBody,
  UpdateTenantStatusBody,
} from '@ap/contracts';
import { apiFetch, type RequestOptions } from './api';

/** Endpoints of the platform owner's side: admin area, operator signup and billing. */

type Opts = Pick<RequestOptions, 'signal' | 'baseUrl'>;
const enc = encodeURIComponent;

export const adminApi = {
  overview: (period: string | undefined, o?: Opts) =>
    apiFetch<AdminOverviewDto>('/admin/overview', { ...o, query: { period }, tenant: false }),
  tenant: (id: string, o?: Opts) =>
    apiFetch<AdminTenantDetailDto>(`/admin/tenants/${enc(id)}`, { ...o, tenant: false }),
  setStatus: (id: string, body: UpdateTenantStatusBody, o?: Opts) =>
    apiFetch<AdminTenantDetailDto>(`/admin/tenants/${enc(id)}/status`, {
      ...o,
      method: 'PATCH',
      body,
      tenant: false,
    }),
  setBilling: (id: string, body: UpdateTenantBillingBody, o?: Opts) =>
    apiFetch<SubscriptionDto>(`/admin/tenants/${enc(id)}/billing`, {
      ...o,
      method: 'PATCH',
      body,
      tenant: false,
    }),
  plans: (o?: Opts) => apiFetch<PlatformPlanDto[]>('/admin/plans', { ...o, tenant: false }),
  createPlan: (body: CreatePlatformPlanBody, o?: Opts) =>
    apiFetch<PlatformPlanDto>('/admin/plans', { ...o, method: 'POST', body, tenant: false }),
  updatePlan: (id: string, body: UpdatePlatformPlanBody, o?: Opts) =>
    apiFetch<PlatformPlanDto>(`/admin/plans/${enc(id)}`, {
      ...o,
      method: 'PATCH',
      body,
      tenant: false,
    }),
  invites: (o?: Opts) => apiFetch<OperatorInviteDto[]>('/admin/invites', { ...o, tenant: false }),
  createInvite: (body: CreateOperatorInviteBody, o?: Opts) =>
    apiFetch<OperatorInviteDto>('/admin/invites', { ...o, method: 'POST', body, tenant: false }),
  system: (o?: Opts) => apiFetch<AdminSystemDto>('/admin/system', { ...o, tenant: false }),
  retryEvent: (id: number, o?: Opts) =>
    apiFetch<AdminSystemDto>(`/admin/system/events/${id}/retry`, {
      ...o,
      method: 'POST',
      tenant: false,
    }),
  findAccount: (contact: string, o?: Opts) =>
    apiFetch<AdminAccountLookupDto>('/admin/accounts', { ...o, query: { contact }, tenant: false }),
  resetAccountTwoFactor: (id: string, o?: Opts) =>
    apiFetch<AdminAccountDto>(`/admin/accounts/${enc(id)}/2fa/reset`, {
      ...o,
      method: 'POST',
      tenant: false,
    }),
  signOutAccount: (id: string, o?: Opts) =>
    apiFetch<AdminAccountDto>(`/admin/accounts/${enc(id)}/sign-out`, {
      ...o,
      method: 'POST',
      tenant: false,
    }),
  contactRequests: (o?: Opts) =>
    apiFetch<ContactRequestDto[]>('/admin/contact-requests', { ...o, tenant: false }),
  setContactHandled: (id: string, handled: boolean, o?: Opts) =>
    apiFetch<ContactRequestDto>(`/admin/contact-requests/${enc(id)}/handled`, {
      ...o,
      method: 'POST',
      body: { handled },
      tenant: false,
    }),
  revokeInvite: (id: string, o?: Opts) =>
    apiFetch<OperatorInviteDto>(`/admin/invites/${enc(id)}/revoke`, {
      ...o,
      method: 'POST',
      tenant: false,
    }),
};

export const signupApi = {
  options: (o?: Opts) => apiFetch<SignupOptionsDto>('/signup/options', { ...o, auth: false }),
  checkSlug: (slug: string, o?: Opts) =>
    apiFetch<SlugCheckDto>('/signup/slug', { ...o, query: { slug }, auth: false }),
  invite: (token: string, o?: Opts) =>
    apiFetch<OperatorInvitePreviewDto>(`/signup/invites/${enc(token)}`, { ...o, auth: false }),
  createTenant: (body: CreateTenantBody, o?: Opts) =>
    apiFetch<CreateTenantResultDto>('/signup/tenants', {
      ...o,
      method: 'POST',
      body,
      tenant: false,
    }),
};

export const operatorPlatformApi = {
  onboarding: (o?: Opts) => apiFetch<OnboardingDto>('/operator/onboarding', o),
  billing: (o?: Opts) => apiFetch<OperatorBillingDto>('/operator/billing', o),
  checkout: (body: StartSubscriptionBody, o?: Opts) =>
    apiFetch<BillingRedirectDto>('/operator/billing/checkout', { ...o, method: 'POST', body }),
  portal: (o?: Opts) =>
    apiFetch<BillingRedirectDto>('/operator/billing/portal', { ...o, method: 'POST' }),
};

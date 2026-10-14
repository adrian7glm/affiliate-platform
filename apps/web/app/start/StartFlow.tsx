'use client';

import type { MeDto, OperatorInvitePreviewDto, SignupOptionsDto } from '@ap/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceGroup, Field, SelectField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconCheck } from '@/components/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { MoneyText } from '@/components/MoneyText';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { authApi } from '@/lib/endpoints';
import { formatBps, formatMoney, slugify } from '@/lib/format';
import { signupApi } from '@/lib/platform-endpoints';
import { CURRENCIES, planDescription } from '@/lib/platform-labels';
import { clearSession, getCachedMe, getToken, setCachedMe, setTenantId } from '@/lib/session';
import { errorMessage, useApi } from '@/lib/useApi';

const TIMEZONES = [
  'Europe/Bucharest',
  'Europe/Chisinau',
  'Europe/Sofia',
  'Europe/Athens',
  'Europe/Budapest',
  'Europe/Belgrade',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/London',
];

type Plan = SignupOptionsDto['plans'][number];

const SLOT = '\u0000';

/** Puts `node` where the `{name}` variable sits in an already translated sentence. */
function withNode(
  translate: (vars: Record<string, string>) => string,
  name: string,
  node: ReactNode,
) {
  const parts = translate({ [name]: SLOT }).split(SLOT);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? node : null}
      {part}
    </Fragment>
  ));
}

function PlanSummary({
  plan,
  feeBps,
  trialDays,
}: {
  plan: Pick<Plan, 'monthlyPriceMinor' | 'currency' | 'maxAffiliates'>;
  feeBps: number;
  trialDays: number;
}) {
  const { t, tp, lang } = useT();
  const price = (
    <MoneyText
      amountMinor={plan.monthlyPriceMinor}
      currency={plan.currency}
      lang={lang}
      className="font-semibold"
    />
  );
  return (
    <ul className="flex flex-col gap-1.5">
      <li className="flex items-start gap-2">
        <IconCheck className="mt-0.5 shrink-0 text-success" size={20} />
        <span>
          {trialDays > 0
            ? withNode((v) => tp('signup.summary.trialThen', trialDays, v), 'price', price)
            : withNode((v) => t('signup.summary.monthly', v), 'price', price)}
        </span>
      </li>
      <li className="flex items-start gap-2">
        <IconCheck className="mt-0.5 shrink-0 text-success" size={20} />
        <span>
          {withNode(
            (v) => t('signup.summary.fee', v),
            'fee',
            <span className="font-semibold">{formatBps(feeBps, lang)}</span>,
          )}
        </span>
      </li>
      <li className="flex items-start gap-2">
        <IconCheck className="mt-0.5 shrink-0 text-success" size={20} />
        <span>
          {plan.maxAffiliates === null
            ? t('signup.summary.unlimitedAffiliates')
            : tp('signup.summary.upToAffiliates', plan.maxAffiliates)}
        </span>
      </li>
    </ul>
  );
}

/**
 * Operator signup: sign in with a code, name the business, pick a plan, land in the console
 * with the guided setup. With an invitation token the plan and fees come from the invitation.
 */
export function StartFlow({ token }: { token: string | null }) {
  const router = useRouter();
  const i18n = useT();
  const { t } = i18n;
  const options = useApi('signup-options', (signal) => signupApi.options({ signal }));
  const invite = useApi(token ? `operator-invite:${token}` : null, (signal) =>
    signupApi.invite(token!, { signal }),
  );
  const [me, setMe] = useState<MeDto | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const cached = getCachedMe();
    if (getToken() && cached) setMe(cached);
    setChecked(true);
    if (!getToken()) return;
    authApi
      .me()
      .then((fresh) => {
        setCachedMe(fresh);
        setMe(fresh);
      })
      .catch(async (err: unknown) => {
        if (isApiError(err) && err.isUnauthorized) {
          await clearSession();
          setMe(null);
        }
      });
  }, []);

  const here = token ? `/start/${token}` : '/start';
  const loginHref = `/login?next=${encodeURIComponent(here)}`;

  async function switchAccount() {
    await clearSession();
    router.push(loginHref);
  }

  const loading = !checked || options.loading || (token !== null && invite.loading && !invite.data);
  const error = options.error ?? invite.error;

  return (
    <main
      className="page-x mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 py-6"
      style={{ paddingTop: 'max(1.5rem, var(--safe-top))' }}
    >
      <div className="flex items-center justify-between gap-2">
        <Link href="/" className="flex min-h-12 items-center gap-2 text-lg font-bold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" width={32} height={32} className="rounded-xl" />
          {t('common.appName')}
        </Link>
        <LanguageSwitcher />
      </div>

      {loading ? <LoadingBlock /> : null}
      {!loading && error ? (
        <Alert tone="error" title={t('signup.linkInvalid')}>
          {isApiError(error) && error.status === 404
            ? t('signup.inviteMissing')
            : errorMessage(error, i18n)}
        </Alert>
      ) : null}

      {!loading && !error && options.data ? (
        <StartContent
          token={token}
          options={options.data}
          invite={invite.data}
          me={me}
          loginHref={loginHref}
          onUseAnotherAccount={() => void switchAccount()}
        />
      ) : null}
    </main>
  );
}

function StartContent({
  token,
  options,
  invite,
  me,
  loginHref,
  onUseAnotherAccount,
}: {
  token: string | null;
  options: SignupOptionsDto;
  invite: OperatorInvitePreviewDto | null;
  me: MeDto | null;
  loginHref: string;
  onUseAnotherAccount: () => void;
}) {
  const { t } = useT();
  if (token && invite) {
    if (invite.status === 'accepted') {
      return (
        <Alert
          tone="info"
          title={t('signup.acceptedTitle')}
          action={<ButtonLink href="/login">{t('signup.signIn')}</ButtonLink>}
        >
          {t('signup.acceptedBody', { business: invite.businessName, email: invite.email })}
        </Alert>
      );
    }
    if (invite.status !== 'pending') {
      return (
        <Alert tone="error" title={t('signup.expiredTitle')}>
          {t('signup.expiredBody')}
        </Alert>
      );
    }
  }

  if (!token && !options.selfSignup) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">{t('signup.inviteOnlyTitle')}</h1>
        <p className="text-muted">{t('signup.inviteOnlyBody')}</p>
        <ButtonLink href="/login" variant="secondary">
          {t('signup.haveAccount')}
        </ButtonLink>
      </div>
    );
  }

  const header = invite ? (
    <div>
      <p className="font-semibold text-brand">{t('signup.inviteEyebrow')}</p>
      <h1 className="text-3xl font-bold">
        {t('signup.inviteHeading', { business: invite.businessName })}
      </h1>
      <p className="mt-2 text-muted">{t('signup.inviteIntro')}</p>
    </div>
  ) : (
    <div>
      <h1 className="text-3xl font-bold">{t('signup.heading')}</h1>
      <p className="mt-2 text-muted">{t('signup.intro')}</p>
    </div>
  );

  if (!me) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        {invite?.plan ? (
          <Card title={t('signup.planTitle', { name: invite.plan.name })}>
            <PlanSummary
              plan={invite.plan}
              feeBps={invite.platformFeeBps}
              trialDays={invite.trialDays}
            />
          </Card>
        ) : (
          <PlanCards plans={options.plans} />
        )}
        <div className="flex flex-col gap-2">
          <ButtonLink href={loginHref} size="lg" block>
            {invite ? t('signup.continueAs', { email: invite.email }) : t('signup.startFree')}
          </ButtonLink>
          <p className="text-center text-sm text-muted">{t('signup.codeNote')}</p>
        </div>
      </div>
    );
  }

  if (invite && me.user.email !== invite.email) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Alert
          tone="warning"
          title={t('signup.wrongAccountTitle', { email: invite.email })}
          action={
            <Button variant="secondary" onClick={onUseAnotherAccount}>
              {t('signup.signInAs', { email: invite.email })}
            </Button>
          }
        >
          {t('signup.currentAccount', { account: me.user.email ?? me.user.phone ?? '' })}
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <BusinessForm token={token} options={options} invite={invite} me={me} />
    </div>
  );
}

function PlanCards({ plans }: { plans: Plan[] }) {
  const tr = useT();
  const { t } = tr;
  if (plans.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {plans.map((plan) => (
        <li key={plan.id}>
          <Card className="h-full">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xl font-bold">{plan.name}</h2>
              {plan.isDefault ? (
                <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-sm font-semibold text-brand-soft-fg">
                  {t('signup.recommended')}
                </span>
              ) : null}
            </div>
            {planDescription(tr, plan) ? (
              <p className="mb-3 text-sm text-muted">{planDescription(tr, plan)}</p>
            ) : null}
            <PlanSummary plan={plan} feeBps={plan.platformFeeBps} trialDays={plan.trialDays} />
          </Card>
        </li>
      ))}
    </ul>
  );
}

function BusinessForm({
  token,
  options,
  invite,
  me,
}: {
  token: string | null;
  options: SignupOptionsDto;
  invite: OperatorInvitePreviewDto | null;
  me: MeDto;
}) {
  const router = useRouter();
  const i18n = useT();
  const { t, tp, lang } = i18n;
  const [name, setName] = useState(invite?.businessName ?? '');
  const [slug, setSlug] = useState(() => slugify(invite?.businessName ?? ''));
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<{
    slug: string;
    available: boolean;
    suggestion: string;
  } | null>(null);
  const [currency, setCurrency] = useState('RON');
  const [timezone, setTimezone] = useState('Europe/Bucharest');
  const [planId, setPlanId] = useState(
    () => options.plans.find((p) => p.isDefault)?.id ?? options.plans[0]?.id ?? '',
  );
  const [ownerName, setOwnerName] = useState(me.user.name ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.includes(browserTz)) setTimezone(browserTz);
  }, []);

  // The booking page address follows the name until the person edits it.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name).slice(0, 40).replace(/-+$/, ''));
  }, [name, slugTouched]);

  useEffect(() => {
    if (slug.length < 3) {
      setSlugState(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      signupApi
        .checkSlug(slug, { signal: controller.signal })
        .then(setSlugState)
        .catch(() => undefined);
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug]);

  const origin = typeof window === 'undefined' ? '' : window.location.host;
  const slugTaken = slugState?.slug === slug && !slugState.available;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = t('signup.form.businessError');
    if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(slug)) next.slug = t('signup.form.slugError');
    else if (slugTaken)
      next.slug = t('signup.form.slugTakenTry', { suggestion: slugState!.suggestion });
    if (!me.user.name && !ownerName.trim()) next.ownerName = t('signup.form.ownerNameError');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const created = await signupApi.createTenant({
        name: name.trim(),
        slug,
        currency,
        timezone,
        ownerName: ownerName.trim() || undefined,
        ...(token ? { inviteToken: token } : { planId: planId || undefined }),
      });
      const fresh = await authApi.me();
      setCachedMe(fresh);
      setTenantId(created.tenantId);
      router.replace('/o?welcome=1');
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        const suggestion = (err.details as { suggestion?: string } | undefined)?.suggestion;
        setErrors({
          slug: suggestion
            ? t('signup.form.slugTakenTry', { suggestion })
            : t('signup.form.slugTaken'),
        });
      } else {
        setError(errorMessage(err, i18n));
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label={t('signup.form.businessName')}
        hint={t('signup.form.businessHint')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('signup.form.businessPlaceholder')}
        autoComplete="organization"
        error={errors.name}
      />
      <Field
        label={t('signup.form.slug')}
        hint={`${origin}/b/${slug || '…'}`}
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
        }}
        autoCapitalize="none"
        spellCheck={false}
        error={
          errors.slug ??
          (slugTaken
            ? t('signup.form.slugTakenTry', { suggestion: slugState!.suggestion })
            : undefined)
        }
      />
      {!me.user.name ? (
        <Field
          label={t('signup.form.ownerName')}
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          autoComplete="name"
          error={errors.ownerName}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label={t('signup.form.currency')}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <SelectField
          label={t('signup.form.timezone')}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace('Europe/', '').replace('_', ' ')}
            </option>
          ))}
        </SelectField>
      </div>
      {!token && options.plans.length > 1 ? (
        <ChoiceGroup
          legend={t('signup.form.plan')}
          hint={t('signup.form.planHint')}
          name="plan"
          value={planId}
          onChange={setPlanId}
          gridClassName="grid grid-cols-1 gap-2 sm:grid-cols-2"
          options={options.plans.map((p) => ({
            value: p.id,
            label: p.name,
            description: p.maxAffiliates
              ? tp('signup.form.planOption', p.maxAffiliates, {
                  price: formatMoney(p.monthlyPriceMinor, p.currency, lang),
                  fee: formatBps(p.platformFeeBps, lang),
                })
              : t('signup.form.planOptionUnlimited', {
                  price: formatMoney(p.monthlyPriceMinor, p.currency, lang),
                  fee: formatBps(p.platformFeeBps, lang),
                }),
          }))}
        />
      ) : null}
      <Button type="submit" size="lg" block loading={busy} loadingText={t('signup.form.creating')}>
        {t('signup.form.submit')}
      </Button>
      <p className="text-center text-sm text-muted">
        {t('signup.form.connectedAs', { account: me.user.email ?? me.user.phone ?? '' })}
      </p>
    </form>
  );
}

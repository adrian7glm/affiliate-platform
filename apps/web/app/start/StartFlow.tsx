'use client';

import type { MeDto, OperatorInvitePreviewDto, SignupOptionsDto } from '@ap/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceGroup, Field, SelectField } from '@/components/Field';
import { IconCheck } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { APP_NAME } from '@/lib/brand';
import { authApi } from '@/lib/endpoints';
import { formatBps, formatMoney, slugify } from '@/lib/format';
import { signupApi } from '@/lib/platform-endpoints';
import { CURRENCIES } from '@/lib/platform-labels';
import { clearSession, getCachedMe, getToken, setCachedMe, setTenantId } from '@/lib/session';
import { errorMessageRo, useApi } from '@/lib/useApi';

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

function PlanSummary({
  plan,
  feeBps,
  trialDays,
}: {
  plan: Pick<Plan, 'monthlyPriceMinor' | 'currency' | 'maxAffiliates'>;
  feeBps: number;
  trialDays: number;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      <li className="flex items-start gap-2">
        <IconCheck className="mt-0.5 shrink-0 text-success" size={20} />
        <span>
          {trialDays > 0 ? `${trialDays} zile gratuit, fără card. Apoi ` : ''}
          <MoneyText
            amountMinor={plan.monthlyPriceMinor}
            currency={plan.currency}
            className="font-semibold"
          />{' '}
          pe lună
        </span>
      </li>
      <li className="flex items-start gap-2">
        <IconCheck className="mt-0.5 shrink-0 text-success" size={20} />
        <span>
          <span className="font-semibold">{formatBps(feeBps)}</span> din fiecare rezervare plătită
        </span>
      </li>
      <li className="flex items-start gap-2">
        <IconCheck className="mt-0.5 shrink-0 text-success" size={20} />
        <span>
          {plan.maxAffiliates === null
            ? 'Afiliați nelimitați'
            : `Până la ${plan.maxAffiliates} afiliați`}
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

  async function useAnotherAccount() {
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
      <Link href="/" className="flex min-h-12 items-center gap-2 self-start text-lg font-bold">
        <img src="/icons/icon.svg" alt="" width={32} height={32} className="rounded-xl" />
        {APP_NAME}
      </Link>

      {loading ? <LoadingBlock /> : null}
      {!loading && error ? (
        <Alert tone="error" title="Linkul nu mai este valabil">
          {isApiError(error) && error.status === 404
            ? 'Invitația nu există. Verifică linkul primit pe email.'
            : errorMessageRo(error)}
        </Alert>
      ) : null}

      {!loading && !error && options.data ? (
        <StartContent
          token={token}
          options={options.data}
          invite={invite.data}
          me={me}
          loginHref={loginHref}
          onUseAnotherAccount={() => void useAnotherAccount()}
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
  if (token && invite) {
    if (invite.status === 'accepted') {
      return (
        <Alert
          tone="info"
          title="Contul a fost deja deschis"
          action={<ButtonLink href="/login">Intră în cont</ButtonLink>}
        >
          Invitația pentru {invite.businessName} a fost folosită. Intră cu {invite.email}.
        </Alert>
      );
    }
    if (invite.status !== 'pending') {
      return (
        <Alert tone="error" title="Invitația a expirat">
          Cere o invitație nouă celui care ți-a trimis-o.
        </Alert>
      );
    }
  }

  if (!token && !options.selfSignup) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">Conturile noi se deschid pe bază de invitație</h1>
        <p className="text-muted">
          Scrie-ne și îți trimitem pe email linkul cu care îți deschizi contul de operator.
        </p>
        <ButtonLink href="/login" variant="secondary">
          Am deja cont
        </ButtonLink>
      </div>
    );
  }

  const header = invite ? (
    <div>
      <p className="font-semibold text-brand">Invitație</p>
      <h1 className="text-3xl font-bold">Deschide contul {invite.businessName}</h1>
      <p className="mt-2 text-muted">
        Rețeaua ta de afiliați: recepționeri și ghizi care îți vând excursiile cu linkuri și coduri
        QR, cu comisioane calculate automat.
      </p>
    </div>
  ) : (
    <div>
      <h1 className="text-3xl font-bold">Deschide-ți contul de operator</h1>
      <p className="mt-2 text-muted">
        Recepționerii, concierge-ii și ghizii îți vând excursiile cu linkuri și coduri QR. Tu
        plătești comision doar pentru ce vând.
      </p>
    </div>
  );

  if (!me) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        {invite?.plan ? (
          <Card title={`Planul ${invite.plan.name}`}>
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
            {invite ? `Continuă cu ${invite.email}` : 'Începe gratuit'}
          </ButtonLink>
          <p className="text-center text-sm text-muted">
            Primești un cod de conectare pe email sau SMS. Fără parolă, fără card.
          </p>
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
          title={`Invitația este pentru ${invite.email}`}
          action={
            <Button variant="secondary" onClick={onUseAnotherAccount}>
              Intră cu {invite.email}
            </Button>
          }
        >
          Acum ești conectat ca {me.user.email ?? me.user.phone}.
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
                  Recomandat
                </span>
              ) : null}
            </div>
            {plan.description ? (
              <p className="mb-3 text-sm text-muted">{plan.description}</p>
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
    if (name.trim().length < 2) next.name = 'Scrie numele afacerii.';
    if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(slug))
      next.slug = 'Între 3 și 48 de litere mici, cifre și cratime.';
    else if (slugTaken) next.slug = `Adresa este ocupată. Încearcă ${slugState!.suggestion}.`;
    if (!me.user.name && !ownerName.trim()) next.ownerName = 'Scrie-ți numele.';
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
        setErrors({ slug: `Adresa este ocupată${suggestion ? `. Încearcă ${suggestion}` : ''}.` });
      } else {
        setError(errorMessageRo(err));
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label="Numele afacerii"
        hint="Așa te văd turiștii pe pagina de rezervare și pe bilet."
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="De exemplu: Delta Boat Tours"
        autoComplete="organization"
        error={errors.name}
      />
      <Field
        label="Adresa paginii de rezervare"
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
          (slugTaken ? `Adresa este ocupată. Încearcă ${slugState!.suggestion}.` : undefined)
        }
      />
      {!me.user.name ? (
        <Field
          label="Numele tău"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          autoComplete="name"
          error={errors.ownerName}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Moneda prețurilor"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <SelectField
          label="Fusul orar"
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
          legend="Planul"
          hint="Poți schimba planul oricând din Abonament."
          name="plan"
          value={planId}
          onChange={setPlanId}
          gridClassName="grid grid-cols-1 gap-2 sm:grid-cols-2"
          options={options.plans.map((p) => ({
            value: p.id,
            label: p.name,
            description: `${formatMoney(p.monthlyPriceMinor, p.currency)}/lună + ${formatBps(p.platformFeeBps)} / rezervare${p.maxAffiliates ? ` · până la ${p.maxAffiliates} afiliați` : ' · afiliați nelimitați'}`,
          }))}
        />
      ) : null}
      <Button type="submit" size="lg" block loading={busy} loadingText="Se creează contul…">
        Creează contul
      </Button>
      <p className="text-center text-sm text-muted">
        Conectat ca {me.user.email ?? me.user.phone}.
      </p>
    </form>
  );
}

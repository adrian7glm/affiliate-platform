'use client';

import type { AuthOptionsDto, MeDto, MembershipDto, SessionDto } from '@ap/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { ChoiceGroup, Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconChevronLeft, IconChevronRight } from '@/components/icons';
import { DemoAccounts } from './DemoAccounts';
import { GoogleButton } from './GoogleButton';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { isApiError } from '@/lib/api';
import {
  isValidEmail,
  isValidPhone,
  maskDestination,
  normalizeEmail,
  normalizePhone,
} from '@/lib/contact';
import { authApi } from '@/lib/endpoints';
import {
  areaForPath,
  areaLabel,
  areaForRole,
  clearSession,
  getCachedMe,
  getTenantId,
  getToken,
  homePathForRole,
  pickMembership,
  roleLabel,
  safeNextPath,
  saveSession,
  setTenantId,
} from '@/lib/session';
import { readString, writeString } from '@/lib/storage';
import { errorMessage } from '@/lib/useApi';

type Method = 'password' | 'email' | 'phone';
type Step = 'destination' | 'code' | 'reset' | 'tenant';

const METHOD_KEY = 'ap.loginMethod';
const RESEND_SECONDS = 30;
const MIN_PASSWORD = 8;
const GOOGLE_ERRORS = ['cancelled', 'expired', 'google', 'email'] as const;

export function LoginFlow({
  next,
  reason,
  prefill,
}: {
  next: string | null;
  reason: string | null;
  /** Phone number or email from an invitation link, filled in for the person. */
  prefill?: string | null;
}) {
  const router = useRouter();
  const i18n = useT();
  const { t, lang } = i18n;
  const nextPath = safeNextPath(next);
  const [step, setStep] = useState<Step>('destination');
  const [method, setMethod] = useState<Method>('password');
  const [rawDestination, setRawDestination] = useState('');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [options, setOptions] = useState<AuthOptionsDto | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [me, setMe] = useState<MeDto | null>(null);
  const codeFormRef = useRef<HTMLFormElement>(null);
  const otpAbortRef = useRef<AbortController | null>(null);

  // Remember the preferred login method; offer the account chooser if already signed in.
  useEffect(() => {
    const saved = readString(METHOD_KEY);
    if (prefill) {
      setMethod(prefill.includes('@') ? 'email' : 'phone');
      setRawDestination(prefill);
    } else if (saved === 'email' || saved === 'phone' || saved === 'password') setMethod(saved);
    if (finishGoogle()) return;
    const cached = getCachedMe();
    if (getToken() && cached && cached.memberships.length > 0 && !nextPath) {
      setMe(cached);
      setStep('tenant');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which ways of signing in the server offers: SMS, Google, demo accounts.
  useEffect(() => {
    const controller = new AbortController();
    authApi
      .options({ signal: controller.signal })
      .then(setOptions)
      .catch(() => {
        // Password and email codes still work; Google and SMS stay hidden.
      });
    return () => controller.abort();
  }, []);

  // SMS codes can be switched off by the platform owner.
  useEffect(() => {
    if (options && !options.sms && method === 'phone' && step === 'destination') {
      setMethod('password');
      setRawDestination('');
    }
  }, [options, method, step]);

  /** Back from Google: the URL fragment carries a short-lived token, or why it failed. */
  function finishGoogle(): boolean {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const handoff = hash.get('handoff');
    const failure = hash.get('google_error');
    if (!handoff && !failure) return false;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (failure) {
      const reason = GOOGLE_ERRORS.find((r) => r === failure) ?? 'google';
      setError(t(`auth.login.googleError.${reason}`));
      return true;
    }
    setBusy(true);
    authApi
      .handoff({ token: handoff! })
      .then((session) => signedIn(session, safeNextPath(hash.get('next')) ?? nextPath))
      .catch((err: unknown) => {
        setError(
          isApiError(err) && err.status === 401
            ? t('auth.login.googleError.expired')
            : errorMessage(err, i18n),
        );
        setBusy(false);
      });
    return true;
  }

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // WebOTP: on supporting browsers the SMS code fills itself in and submits.
  useEffect(() => {
    if (step !== 'code' || method !== 'phone' || !('OTPCredential' in window)) return;
    const controller = new AbortController();
    otpAbortRef.current = controller;
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: controller.signal } as CredentialRequestOptions)
      .then((credential) => {
        const otp = credential as OTPCredential | null;
        if (!otp?.code) return;
        setCode(otp.code);
        setTimeout(() => codeFormRef.current?.requestSubmit(), 0);
      })
      .catch(() => {
        // Aborted, dismissed or unsupported: manual entry still works.
      });
    return () => controller.abort();
  }, [step, method, destination]);

  function stopOtpListener() {
    otpAbortRef.current?.abort();
    otpAbortRef.current = null;
  }

  async function requestCode(target: string, then: 'code' | 'reset' = 'code') {
    setError(null);
    setBusy(true);
    try {
      await authApi.requestOtp({ destination: target, locale: lang });
      setDestination(target);
      setCode('');
      setNewPassword('');
      setStep(then);
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  /** The email typed in the form, or null after showing why it is not valid. */
  function typedEmail(): string | null {
    const target = normalizeEmail(rawDestination);
    if (!isValidEmail(target)) {
      setFieldError(t('auth.login.emailInvalid'));
      return null;
    }
    return target;
  }

  async function passwordLogin(email: string, secret: string) {
    setError(null);
    setBusy(true);
    try {
      signedIn(await authApi.passwordLogin({ email, password: secret }), nextPath);
    } catch (err) {
      setError(
        isApiError(err) && err.status === 401
          ? t('auth.login.passwordWrong')
          : errorMessage(err, i18n),
      );
      setBusy(false);
    }
  }

  function forgotPassword() {
    setFieldError(null);
    setPasswordError(null);
    const target = typedEmail();
    if (target) void requestCode(target, 'reset');
  }

  function onSubmitDestination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setPasswordError(null);
    let target: string;
    if (method === 'password') {
      const email = typedEmail();
      if (!password) setPasswordError(t('auth.login.passwordRequired'));
      if (!email || !password) return;
      writeString(METHOD_KEY, method);
      void passwordLogin(email, password);
      return;
    }
    if (method === 'phone') {
      target = normalizePhone(rawDestination);
      if (!isValidPhone(target)) {
        setFieldError(t('auth.login.phoneInvalid'));
        return;
      }
    } else {
      target = normalizeEmail(rawDestination);
      if (!isValidEmail(target)) {
        setFieldError(t('auth.login.emailInvalid'));
        return;
      }
    }
    writeString(METHOD_KEY, method);
    void requestCode(target);
  }

  function signedIn(session: SessionDto, next: string | null) {
    const profile: MeDto = { user: session.user, memberships: session.memberships };
    saveSession(session.token, profile);
    routeAfterLogin(profile, next);
  }

  function routeAfterLogin(session: MeDto, nextPath: string | null) {
    const memberships = session.memberships;
    // Invite links and operator signup work before the person has any membership.
    if (
      nextPath?.startsWith('/join/') ||
      nextPath === '/start' ||
      nextPath?.startsWith('/start/')
    ) {
      router.replace(nextPath);
      return;
    }
    if (
      session.user.isPlatformAdmin &&
      (memberships.length === 0 || nextPath?.startsWith('/admin'))
    ) {
      router.replace(nextPath?.startsWith('/admin') ? nextPath : '/admin');
      return;
    }
    if (memberships.length === 0) {
      setMe(session);
      setStep('tenant');
      return;
    }
    const nextArea = nextPath ? areaForPath(nextPath) : null;
    if (nextPath && nextArea) {
      const membership = pickMembership(memberships, nextArea, getTenantId());
      if (membership) {
        setTenantId(membership.tenantId);
        router.replace(nextPath);
        return;
      }
    }
    if (memberships.length === 1) {
      const only = memberships[0]!;
      setTenantId(only.tenantId);
      router.replace(nextPath && !nextArea ? nextPath : homePathForRole(only.role));
      return;
    }
    setMe(session);
    setStep('tenant');
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    stopOtpListener();
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setFieldError(t('auth.login.codeLength'));
      return;
    }
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      signedIn(await authApi.verifyOtp({ destination, code: clean }), nextPath);
    } catch (err) {
      // The API answers 401 for a wrong or expired code, 400 for a malformed one.
      const message =
        isApiError(err) && (err.status === 401 || err.status === 400)
          ? t('auth.login.codeWrong')
          : errorMessage(err, i18n);
      setError(message);
      setBusy(false);
    }
  }

  async function onSubmitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = code.replace(/\D/g, '');
    setFieldError(clean.length === 6 ? null : t('auth.login.codeLength'));
    setPasswordError(newPassword.length >= MIN_PASSWORD ? null : t('auth.login.newPasswordShort'));
    if (clean.length !== 6 || newPassword.length < MIN_PASSWORD) return;
    setError(null);
    setBusy(true);
    try {
      signedIn(
        await authApi.passwordReset({ email: destination, code: clean, password: newPassword }),
        nextPath,
      );
    } catch (err) {
      setError(
        isApiError(err) && err.status === 401 ? t('auth.login.codeWrong') : errorMessage(err, i18n),
      );
      setBusy(false);
    }
  }

  function chooseMembership(membership: MembershipDto) {
    setTenantId(membership.tenantId);
    router.replace(homePathForRole(membership.role));
  }

  async function useAnotherAccount() {
    await clearSession();
    setMe(null);
    setStep('destination');
  }

  return (
    <main
      className="page-x mx-auto flex min-h-dvh w-full max-w-md flex-col py-6"
      style={{ paddingTop: 'max(1.5rem, var(--safe-top))' }}
    >
      <div className="mb-8 flex items-center justify-between gap-3">
        <Link href="/" className="flex min-h-12 items-center gap-2 text-lg font-bold">
          <img src="/icons/icon.svg" alt="" width={36} height={36} className="rounded-xl" />
          {t('common.appName')}
        </Link>
        <LanguageSwitcher />
      </div>

      {reason === 'no-access' && step === 'destination' ? (
        <Alert tone="warning" className="mb-6" title={t('auth.login.noAccessTitle')}>
          {t('auth.login.noAccessBody')}
        </Alert>
      ) : null}

      {step === 'destination' ? (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl font-bold">{t('auth.login.title')}</h1>
            <p className="mt-2 text-muted">{t('auth.login.intro')}</p>
          </div>

          {options?.google ? (
            <>
              <GoogleButton
                href={authApi.googleStartUrl(nextPath)}
                label={t('auth.login.google')}
              />
              <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                {t('auth.login.or')}
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          ) : null}

          <form
            onSubmit={onSubmitDestination}
            method="post"
            noValidate
            className="flex flex-col gap-5"
          >
            <ChoiceGroup<Method>
              legend={t('auth.login.howLegend')}
              name="method"
              value={method}
              onChange={(m) => {
                if (m === 'phone' || method === 'phone') setRawDestination('');
                setMethod(m);
                setFieldError(null);
                setPasswordError(null);
                setError(null);
              }}
              gridClassName={`grid gap-2 ${options?.sms ? 'grid-cols-3' : 'grid-cols-2'}`}
              options={[
                { value: 'password', label: t('auth.login.methodPassword') },
                { value: 'email', label: t('auth.login.methodEmailCode') },
                ...(options?.sms
                  ? [{ value: 'phone' as const, label: t('auth.login.methodSmsCode') }]
                  : []),
              ]}
            />

            {method === 'phone' ? (
              <Field
                key="phone"
                label={t('auth.login.phoneLabel')}
                hint={t('auth.login.phoneHint')}
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="send"
                required
                value={rawDestination}
                onChange={(e) => setRawDestination(e.target.value)}
                error={fieldError}
              />
            ) : (
              <Field
                key="email"
                label={t('auth.login.emailLabel')}
                name="email"
                type="email"
                inputMode="email"
                autoComplete={method === 'password' ? 'username' : 'email'}
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint={method === 'password' ? 'next' : 'send'}
                required
                value={rawDestination}
                onChange={(e) => setRawDestination(e.target.value)}
                error={fieldError}
              />
            )}

            {method === 'password' ? (
              <Field
                label={t('auth.login.passwordLabel')}
                name="password"
                type="password"
                autoComplete="current-password"
                enterKeyHint="go"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                }}
                error={passwordError}
              />
            ) : null}

            {error ? <Alert tone="error">{error}</Alert> : null}

            <Button
              type="submit"
              size="lg"
              block
              loading={busy}
              loadingText={
                method === 'password' ? t('auth.login.verifying') : t('auth.login.sending')
              }
            >
              {method === 'password' ? t('auth.login.submit') : t('auth.login.sendCode')}
            </Button>

            {method === 'password' ? (
              <Button variant="ghost" disabled={busy} onClick={forgotPassword}>
                {t('auth.login.forgotPassword')}
              </Button>
            ) : null}
          </form>

          {options && options.demoAccounts.length > 0 ? (
            <DemoAccounts
              accounts={options.demoAccounts}
              busy={busy}
              onUse={(account) => {
                setMethod('password');
                setRawDestination(account.email);
                setPassword(account.password);
                setFieldError(null);
                setPasswordError(null);
                void passwordLogin(account.email, account.password);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {step === 'reset' ? (
        <form onSubmit={onSubmitReset} method="post" noValidate className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl font-bold">{t('auth.login.resetTitle')}</h1>
            <p className="mt-2 text-muted">
              {t('auth.login.codeSentBefore')}{' '}
              <strong className="text-fg">{maskDestination(destination)}</strong>
              {t('auth.login.codeSentAfter')}
            </p>
          </div>
          <Field
            label={t('auth.login.codeLabel')}
            hint={t('auth.login.codeHint')}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              setFieldError(null);
            }}
            error={fieldError}
            className="[&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.4em]"
          />
          <Field
            label={t('auth.login.newPasswordLabel')}
            hint={t('auth.login.newPasswordHint')}
            name="new-password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            enterKeyHint="go"
            required
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setPasswordError(null);
            }}
            error={passwordError}
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button
            type="submit"
            size="lg"
            block
            loading={busy}
            loadingText={t('auth.login.verifying')}
          >
            {t('auth.login.resetSubmit')}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              icon={<IconChevronLeft />}
              onClick={() => {
                setStep('destination');
                setError(null);
                setFieldError(null);
                setPasswordError(null);
              }}
            >
              {t('auth.login.otherEmail')}
            </Button>
            <Button
              variant="ghost"
              disabled={resendIn > 0 || busy}
              onClick={() => void requestCode(destination, 'reset')}
            >
              {resendIn > 0
                ? t('auth.login.resendIn', { seconds: resendIn })
                : t('auth.login.resend')}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'code' ? (
        <form
          ref={codeFormRef}
          onSubmit={onSubmitCode}
          method="post"
          noValidate
          className="flex flex-col gap-5"
        >
          <div>
            <h1 className="text-3xl font-bold">{t('auth.login.codeTitle')}</h1>
            <p className="mt-2 text-muted">
              {t('auth.login.codeSentBefore')}{' '}
              <strong className="text-fg">{maskDestination(destination)}</strong>
              {t('auth.login.codeSentAfter')}
            </p>
          </div>

          <Field
            label={t('auth.login.codeLabel')}
            hint={t('auth.login.codeHint')}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            enterKeyHint="go"
            required
            autoFocus
            value={code}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              setFieldError(null);
              if (digits.length === 6 && !busy) {
                setTimeout(() => codeFormRef.current?.requestSubmit(), 0);
              }
            }}
            error={fieldError}
            className="[&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.4em]"
          />

          {error ? <Alert tone="error">{error}</Alert> : null}

          <Button
            type="submit"
            size="lg"
            block
            loading={busy}
            loadingText={t('auth.login.verifying')}
          >
            {t('auth.login.submit')}
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              icon={<IconChevronLeft />}
              onClick={() => {
                stopOtpListener();
                setStep('destination');
                setError(null);
                setFieldError(null);
              }}
            >
              {method === 'phone' ? t('auth.login.otherPhone') : t('auth.login.otherEmail')}
            </Button>
            <Button
              variant="ghost"
              disabled={resendIn > 0 || busy}
              onClick={() => {
                stopOtpListener();
                void requestCode(destination);
              }}
            >
              {resendIn > 0
                ? t('auth.login.resendIn', { seconds: resendIn })
                : t('auth.login.resend')}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'tenant' && me ? (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl font-bold">
              {me.memberships.length > 0
                ? t('auth.login.chooseTitle')
                : t('auth.login.noMembershipTitle')}
            </h1>
            <p className="mt-2 text-muted">
              {me.memberships.length > 0
                ? t('auth.login.chooseIntro')
                : t('auth.login.noMembershipBody')}
            </p>
          </div>
          {me.memberships.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {me.memberships.map((m) => (
                <li key={`${m.tenantId}-${m.role}`}>
                  <button
                    type="button"
                    onClick={() => chooseMembership(m)}
                    className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 border-line-strong bg-surface px-4 py-3 text-left hover:border-brand"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{m.tenantName}</span>
                      <span className="block text-sm text-muted">
                        {t('auth.login.membershipLine', {
                          role: roleLabel(i18n, m.role),
                          area: areaLabel(i18n, areaForRole(m.role)),
                        })}
                      </span>
                    </span>
                    <IconChevronRight className="shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {me.user.isPlatformAdmin ? (
            <ButtonLink href="/admin" variant="secondary">
              {t('auth.login.platformAdmin')}
            </ButtonLink>
          ) : null}
          {me.memberships.length === 0 ? (
            <ButtonLink href="/start">{t('auth.login.openOperator')}</ButtonLink>
          ) : null}
          <Button variant="secondary" onClick={() => void useAnotherAccount()}>
            {t('auth.useAnotherAccount')}
          </Button>
        </div>
      ) : null}
    </main>
  );
}

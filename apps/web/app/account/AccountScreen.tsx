'use client';

import type { AccountSecurityDto, MeDto, TwoFactorSetupDto } from '@ap/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconChevronLeft, IconCopy, IconLogout, IconShield } from '@/components/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { QrCode } from '@/components/QrCode';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import {
  isValidEmail,
  isValidPhone,
  maskDestination,
  normalizeEmail,
  normalizePhone,
} from '@/lib/contact';
import { formatDate } from '@/lib/dates';
import { accountApi, authApi } from '@/lib/endpoints';
import {
  clearSession,
  getCachedMe,
  getToken,
  homePathFor,
  replaceToken,
  setCachedMe,
} from '@/lib/session';
import { copyText } from '@/lib/share';
import { errorMessage } from '@/lib/useApi';

/**
 * The signed-in person's own account, the same for every role: the phone number and email
 * they sign in with, two-step login with an authenticator app, and signing out other devices.
 */
export function AccountScreen() {
  const router = useRouter();
  const i18n = useT();
  const { t } = i18n;
  const [me, setMe] = useState<MeDto | null>(null);
  const [security, setSecurity] = useState<AccountSecurityDto | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [profile, sec] = await Promise.all([authApi.me(), accountApi.security()]);
      setCachedMe(profile);
      setMe(profile);
      setSecurity(sec);
    } catch (err) {
      if (isApiError(err) && err.isUnauthorized) {
        await clearSession();
        router.replace(`/login?next=${encodeURIComponent('/account')}`);
        return;
      }
      setLoadError(err);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent('/account')}`);
      return;
    }
    setMe(getCachedMe());
    void load();
  }, [load, router]);

  async function signOut() {
    await clearSession();
    router.replace('/login');
  }

  const back = homePathFor(me);

  return (
    <main
      className="page-x mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 py-6"
      style={{ paddingTop: 'max(1.5rem, var(--safe-top))' }}
    >
      <div className="flex items-center justify-between gap-3">
        <Link
          href={back}
          className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-xl px-2 font-semibold text-brand hover:bg-brand-soft"
        >
          <IconChevronLeft />
          {t('account.back')}
        </Link>
        <LanguageSwitcher compact />
      </div>

      <div>
        <h1 className="text-3xl font-bold">{t('account.title')}</h1>
        {me ? (
          <p className="mt-1 text-muted">{me.user.name ?? me.user.email ?? me.user.phone}</p>
        ) : null}
      </div>

      {notice ? (
        <Alert
          tone="success"
          action={
            <Button variant="ghost" onClick={() => setNotice(null)}>
              {t('common.close')}
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}

      {loadError ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(loadError, i18n)}
        </Alert>
      ) : null}

      {!security ? (
        loadError ? null : (
          <LoadingBlock />
        )
      ) : (
        <>
          <ContactCard
            security={security}
            onChanged={(profile, message) => {
              setCachedMe(profile);
              setMe(profile);
              setSecurity({ ...security, email: profile.user.email, phone: profile.user.phone });
              setNotice(message);
            }}
          />
          <TwoFactorCard security={security} onChanged={() => void load()} onNotice={setNotice} />
          <DevicesCard onNotice={setNotice} />
        </>
      )}

      <Button variant="secondary" icon={<IconLogout />} onClick={() => void signOut()}>
        {t('common.signOut')}
      </Button>
    </main>
  );
}

// ------------------------------------------------------------------------------------------------
// Phone number and email
// ------------------------------------------------------------------------------------------------

type ContactKind = 'phone' | 'email';

function ContactCard({
  security,
  onChanged,
}: {
  security: AccountSecurityDto;
  onChanged: (me: MeDto, message: string) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState<ContactKind | null>(null);

  const rows: { kind: ContactKind; label: string; value: string | null }[] = [
    { kind: 'phone', label: t('account.contact.phone'), value: security.phone },
    { kind: 'email', label: t('account.contact.email'), value: security.email },
  ];

  return (
    <Card title={t('account.contact.title')} description={t('account.contact.intro')}>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row) => (
          <li key={row.kind} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm text-muted">{row.label}</p>
              <p className="truncate font-semibold">{row.value ?? t('account.contact.none')}</p>
            </div>
            <Button variant="secondary" onClick={() => setEditing(row.kind)}>
              {row.value ? t('account.contact.change') : t('account.contact.add')}
            </Button>
          </li>
        ))}
      </ul>
      {editing ? (
        <ContactDialog
          kind={editing}
          onClose={() => setEditing(null)}
          onDone={(me) => {
            setEditing(null);
            onChanged(
              me,
              editing === 'phone'
                ? t('account.contact.phoneSaved')
                : t('account.contact.emailSaved'),
            );
          }}
        />
      ) : null}
    </Card>
  );
}

function ContactDialog({
  kind,
  onClose,
  onDone,
}: {
  kind: ContactKind;
  onClose: () => void;
  onDone: (me: MeDto) => void;
}) {
  const i18n = useT();
  const { t, lang } = i18n;
  const [raw, setRaw] = useState('');
  const [destination, setDestination] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = kind === 'phone' ? normalizePhone(raw) : normalizeEmail(raw);
    const valid = kind === 'phone' ? isValidPhone(target) : isValidEmail(target);
    if (!valid) {
      setFieldError(kind === 'phone' ? t('auth.login.phoneInvalid') : t('auth.login.emailInvalid'));
      return;
    }
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      await accountApi.requestContactChange({ destination: target, locale: lang });
      setDestination(target);
      setCode('');
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!destination) return;
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setFieldError(t('auth.login.codeLength'));
      return;
    }
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      onDone(await accountApi.confirmContactChange({ destination, code: clean }));
    } catch (err) {
      // A wrong or expired code is a 401 from the API, not a lost session.
      setError(
        isApiError(err) && (err.status === 401 || err.status === 400)
          ? t('auth.login.codeWrong')
          : errorMessage(err, i18n),
      );
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === 'phone' ? t('account.contact.phoneTitle') : t('account.contact.emailTitle')}
      description={destination ? undefined : t('account.contact.dialogIntro')}
    >
      {destination === null ? (
        <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
          {kind === 'phone' ? (
            <Field
              label={t('auth.login.phoneLabel')}
              hint={t('auth.login.phoneHint')}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              autoFocus
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              error={fieldError}
            />
          ) : (
            <Field
              label={t('auth.login.emailLabel')}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              required
              autoFocus
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              error={fieldError}
            />
          )}
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" block loading={busy} loadingText={t('auth.login.sending')}>
            {t('auth.login.sendCode')}
          </Button>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate className="flex flex-col gap-4">
          <p className="text-muted">
            {t('auth.login.codeSentBefore')}{' '}
            <strong className="text-fg">{maskDestination(destination)}</strong>
            {t('auth.login.codeSentAfter')}
          </p>
          <Field
            label={t('auth.login.codeLabel')}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            error={fieldError}
            className="[&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.4em]"
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" block loading={busy} loadingText={t('auth.login.verifying')}>
            {t('account.contact.save')}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------
// Two-step login
// ------------------------------------------------------------------------------------------------

function TwoFactorCard({
  security,
  onChanged,
  onNotice,
}: {
  security: AccountSecurityDto;
  onChanged: () => void;
  onNotice: (message: string) => void;
}) {
  const i18n = useT();
  const { t, lang } = i18n;
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirm, setConfirm] = useState<'disable' | 'codes' | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <IconShield className="text-brand" />
          {t('account.twoFactor.title')}
        </span>
      }
      description={t('account.twoFactor.intro')}
    >
      {security.twoFactorEnabled ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success" title={t('account.twoFactor.on')}>
            {security.twoFactorEnabledAt
              ? t('account.twoFactor.onSince', {
                  date: formatDate(security.twoFactorEnabledAt, null, lang),
                })
              : null}{' '}
            {t('account.twoFactor.codesLeft', { count: security.recoveryCodesLeft })}
          </Alert>
          {security.recoveryCodesLeft <= 3 ? (
            <Alert tone="warning">{t('account.twoFactor.codesLow')}</Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setConfirm('codes')}>
              {t('account.twoFactor.newCodes')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm('disable')}>
              {t('account.twoFactor.turnOff')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted">{t('account.twoFactor.offBody')}</p>
          <Button onClick={() => setSetupOpen(true)} icon={<IconShield />}>
            {t('account.twoFactor.turnOn')}
          </Button>
        </div>
      )}

      {setupOpen ? (
        <SetupDialog
          onClose={() => {
            setSetupOpen(false);
            onChanged();
          }}
        />
      ) : null}

      {confirm ? (
        <CodeDialog
          title={
            confirm === 'disable'
              ? t('account.twoFactor.turnOffTitle')
              : t('account.twoFactor.newCodesTitle')
          }
          intro={
            confirm === 'disable'
              ? t('account.twoFactor.turnOffIntro')
              : t('account.twoFactor.newCodesIntro')
          }
          submitLabel={
            confirm === 'disable' ? t('account.twoFactor.turnOff') : t('account.twoFactor.newCodes')
          }
          danger={confirm === 'disable'}
          onClose={() => setConfirm(null)}
          onSubmit={async (code) => {
            if (confirm === 'disable') {
              const me = await accountApi.disableTwoFactor(code);
              setCachedMe(me);
              setConfirm(null);
              onNotice(t('account.twoFactor.turnedOff'));
            } else {
              const result = await accountApi.newRecoveryCodes(code);
              setConfirm(null);
              setNewCodes(result.recoveryCodes);
            }
            onChanged();
          }}
        />
      ) : null}

      {newCodes ? (
        <Dialog open onClose={() => setNewCodes(null)} title={t('account.twoFactor.codesTitle')}>
          <RecoveryCodes codes={newCodes} onDone={() => setNewCodes(null)} />
        </Dialog>
      ) : null}
    </Card>
  );
}

/** Scan the QR code, type the first code, then keep the recovery codes. */
function SetupDialog({ onClose }: { onClose: () => void }) {
  const i18n = useT();
  const { t } = i18n;
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    accountApi
      .startTwoFactor()
      .then((result) => {
        if (alive) setSetup(result);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorMessage(err, i18n));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError(t('auth.login.codeLength'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await accountApi.enableTwoFactor(clean);
      // The other devices were signed out; this one continues with the new token.
      replaceToken(result.token);
      setCodes(result.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={codes ? t('account.twoFactor.codesTitle') : t('account.twoFactor.setupTitle')}
      lightDismiss={false}
    >
      {codes ? (
        <RecoveryCodes codes={codes} onDone={onClose} />
      ) : !setup ? (
        error ? (
          <Alert tone="error">{error}</Alert>
        ) : (
          <LoadingBlock />
        )
      ) : (
        <form onSubmit={enable} noValidate className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted">
            <li>{t('account.twoFactor.step1')}</li>
            <li>{t('account.twoFactor.step2')}</li>
            <li>{t('account.twoFactor.step3')}</li>
          </ol>
          <div className="mx-auto w-56">
            <QrCode value={setup.otpauthUrl} label={t('account.twoFactor.qrLabel')} />
          </div>
          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer font-semibold">
              {t('account.twoFactor.cantScan')}
            </summary>
            <p className="mt-2 text-sm text-muted">{t('account.twoFactor.typeKey')}</p>
            <p className="mt-1 break-all font-mono text-lg tracking-wider">
              {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
            </p>
          </details>
          <Field
            label={t('auth.mfa.codeLabel')}
            name="totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="[&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.4em]"
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" block loading={busy} loadingText={t('auth.login.verifying')}>
            {t('account.twoFactor.turnOn')}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">{t('account.twoFactor.codesIntro')}</Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-4 font-mono text-lg">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button
        variant="secondary"
        icon={<IconCopy />}
        onClick={() => void copyText(codes.join('\n')).then((ok) => setCopied(ok))}
      >
        {copied ? t('account.twoFactor.copied') : t('account.twoFactor.copy')}
      </Button>
      <Button onClick={onDone}>{t('account.twoFactor.saved')}</Button>
    </div>
  );
}

/** Asks for a current code from the app (or a recovery code) before a sensitive change. */
function CodeDialog({
  title,
  intro,
  submitLabel,
  danger,
  onClose,
  onSubmit,
}: {
  title: string;
  intro: string;
  submitLabel: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (code: string) => Promise<void>;
}) {
  const i18n = useT();
  const { t } = i18n;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = code.trim();
    if (clean.length < 6) {
      setError(t('auth.login.codeLength'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(clean);
    } catch (err) {
      setError(errorMessage(err, i18n));
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={title} description={intro}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          label={t('account.twoFactor.codeOrRecovery')}
          name="code"
          type="text"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="[&_input]:text-center [&_input]:font-mono [&_input]:text-xl [&_input]:tracking-widest"
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button
          type="submit"
          block
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          loadingText={t('auth.login.verifying')}
        >
          {submitLabel}
        </Button>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------
// Devices
// ------------------------------------------------------------------------------------------------

function DevicesCard({ onNotice }: { onNotice: (message: string) => void }) {
  const i18n = useT();
  const { t } = i18n;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOutOthers() {
    setBusy(true);
    setError(null);
    try {
      const { token } = await accountApi.signOutOtherDevices();
      replaceToken(token);
      setConfirming(false);
      onNotice(t('account.devices.done'));
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('account.devices.title')} description={t('account.devices.intro')}>
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        {t('account.devices.signOutOthers')}
      </Button>
      {confirming ? (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          title={t('account.devices.confirmTitle')}
          description={t('account.devices.confirmBody')}
        >
          <div className="flex flex-col gap-3">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Button block loading={busy} onClick={() => void signOutOthers()}>
              {t('account.devices.signOutOthers')}
            </Button>
            <Button block variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

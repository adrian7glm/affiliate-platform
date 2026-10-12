'use client';

import type { MeDto } from '@ap/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { authApi } from '@/lib/endpoints';
import { clearSession, getCachedMe, getToken, setCachedMe, setTenantId } from '@/lib/session';
import { errorMessage, useApi } from '@/lib/useApi';

export function JoinFlow({ token }: { token: string }) {
  const router = useRouter();
  const i18n = useT();
  const { t } = i18n;
  const preview = useApi(`invite:${token}`, (signal) => authApi.invitePreview(token, { signal }));
  const [me, setMe] = useState<MeDto | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hasToken = !!getToken();
    setSignedIn(hasToken);
    const cached = getCachedMe();
    if (hasToken && cached) {
      setMe(cached);
      setName(cached.user.name ?? '');
    }
  }, []);

  useEffect(() => {
    if (preview.data && !name) setName(me?.user.name ?? preview.data.affiliateName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data]);

  const loginHref = `/login?next=${encodeURIComponent(`/join/${token}`)}`;

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.acceptInvite({ token, name: name.trim() || undefined });
      setCachedMe(result);
      const membership =
        result.memberships.find(
          (m) => m.role === 'affiliate' && m.tenantName === preview.data?.tenantName,
        ) ?? result.memberships.find((m) => m.role === 'affiliate');
      if (membership) setTenantId(membership.tenantId);
      router.replace('/a');
    } catch (err) {
      if (isApiError(err) && err.isUnauthorized) {
        await clearSession();
        router.replace(loginHref);
        return;
      }
      setError(
        isApiError(err) && (err.status === 409 || err.status === 422 || err.status === 410)
          ? err.message || t('auth.join.cannotUse')
          : errorMessage(err, i18n),
      );
      setBusy(false);
    }
  }

  async function switchAccount() {
    await clearSession();
    router.replace(loginHref);
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

      {preview.loading && !preview.data ? <LoadingBlock /> : null}

      {preview.error ? (
        <Alert tone="error" title={t('auth.join.cannotOpen')}>
          {isApiError(preview.error) && preview.error.isNotFound
            ? t('auth.join.invalidLink')
            : errorMessage(preview.error, i18n)}
        </Alert>
      ) : null}

      {preview.data ? (
        <div className="flex flex-col gap-5">
          <div>
            <p className="font-semibold text-brand">{t('auth.join.eyebrow')}</p>
            <h1 className="mt-1 text-3xl font-bold">
              {t('auth.join.title', { tenant: preview.data.tenantName })}
            </h1>
            <p className="mt-2 text-muted">
              {t('auth.join.intro')}
            </p>
          </div>

          {preview.data.expired ? (
            <Alert tone="warning" title={t('auth.join.expiredTitle')}>
              {t('auth.join.expiredBody')}
            </Alert>
          ) : signedIn ? (
            <Card>
              <form onSubmit={accept} method="post" className="flex flex-col gap-4">
                <Field
                  label={t('auth.join.nameLabel')}
                  hint={t('auth.join.nameHint')}
                  name="name"
                  autoComplete="name"
                  enterKeyHint="done"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
                {error ? <Alert tone="error">{error}</Alert> : null}
                <Button type="submit" size="lg" block loading={busy} loadingText={t('auth.join.accepting')}>
                  {t('auth.join.accept')}
                </Button>
                {me ? (
                  <p className="text-sm text-muted">
                    {t('auth.join.signedInAs', {
                      who: me.user.phone ?? me.user.email ?? me.user.name ?? '',
                    })}{' '}
                    <button
                      type="button"
                      className="font-semibold text-brand underline"
                      onClick={() => void switchAccount()}
                    >
                      {t('auth.useAnotherAccount')}
                    </button>
                  </p>
                ) : null}
              </form>
            </Card>
          ) : (
            <Card>
              <p className="mb-4">
                {t('auth.join.forBefore')}
                <strong>{preview.data.affiliateName}</strong>
                {t('auth.join.forAfter')}
              </p>
              <ButtonLink href={loginHref} size="lg" block>
                {t('auth.join.continue')}
              </ButtonLink>
            </Card>
          )}
        </div>
      ) : null}
    </main>
  );
}

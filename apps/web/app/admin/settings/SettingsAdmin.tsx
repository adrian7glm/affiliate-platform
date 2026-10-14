'use client';

import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useT } from '@/components/I18nProvider';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { adminApi } from '@/lib/platform-endpoints';
import { errorMessage, useApi } from '@/lib/useApi';

/** How people can sign in: the SMS switch, plus Google and the demo accounts set on the server. */
export function SettingsAdmin() {
  const i18n = useT();
  const { t } = i18n;
  const settings = useApi('admin-settings', (signal) => adminApi.settings({ signal }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = settings.data;

  async function toggleSms() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      settings.setData(await adminApi.updateSettings({ smsLogin: !data.smsLogin }));
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  const onOff = (on: boolean) => (
    <StatusChip tone={on ? 'success' : 'neutral'}>
      {on ? t('admin.settings.on') : t('admin.settings.off')}
    </StatusChip>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('admin.settings.title')} description={t('admin.settings.description')} />
      {settings.error ? <Alert tone="error">{errorMessage(settings.error, i18n)}</Alert> : null}
      {settings.loading && !data ? <LoadingBlock /> : null}
      {data ? (
        <>
          <Card title={t('admin.settings.smsTitle')} action={onOff(data.smsLogin)}>
            <p className="text-muted">{t('admin.settings.smsText')}</p>
            {!data.smsAvailable ? (
              <Alert tone="warning" className="mt-3">
                {t('admin.settings.smsUnavailable')}
              </Alert>
            ) : null}
            {error ? (
              <Alert tone="error" className="mt-3">
                {error}
              </Alert>
            ) : null}
            <Button
              className="mt-4"
              variant={data.smsLogin ? 'secondary' : 'primary'}
              loading={busy}
              onClick={() => void toggleSms()}
            >
              {data.smsLogin ? t('admin.settings.smsTurnOff') : t('admin.settings.smsTurnOn')}
            </Button>
          </Card>
          <Card title={t('admin.settings.googleTitle')} action={onOff(data.googleLogin)}>
            <p className="text-muted">
              {data.googleLogin ? t('admin.settings.googleOn') : t('admin.settings.googleOff')}
            </p>
          </Card>
          <Card title={t('admin.settings.demoTitle')} action={onOff(data.demoMode)}>
            <p className="text-muted">
              {data.demoMode ? t('admin.settings.demoOn') : t('admin.settings.demoOff')}
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}

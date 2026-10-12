'use client';

import type { AdminLanguageDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconDownload, IconPlus } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { translationsAdminApi } from '@/lib/i18n-api';
import { errorMessage, useApi } from '@/lib/useApi';
import { downloadFile, languageFile } from './files';

/** The platform's languages: progress of each, show/hide, add, download the language file. */
export function LanguagesAdmin() {
  const i18n = useT();
  const { t } = i18n;
  const list = useApi('admin-languages', (signal) => translationsAdminApi.languages({ signal }));
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const replace = (language: AdminLanguageDto) =>
    list.setData((all) => all?.map((l) => (l.code === language.code ? language : l)) ?? null);

  const toggle = async (language: AdminLanguageDto) => {
    setBusy(language.code);
    setError(null);
    try {
      replace(
        await translationsAdminApi.updateLanguage(language.code, { enabled: !language.enabled }),
      );
      i18n.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const download = async (language: AdminLanguageDto) => {
    setBusy(language.code);
    setError(null);
    try {
      const texts = await translationsAdminApi.texts(language.code);
      downloadFile(`${language.code}.json`, languageFile(texts.language, texts.entries));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (language: AdminLanguageDto) => {
    if (!window.confirm(t('translations.confirmDelete', { name: language.name }))) return;
    setBusy(language.code);
    setError(null);
    try {
      await translationsAdminApi.deleteLanguage(language.code);
      list.setData((all) => all?.filter((l) => l.code !== language.code) ?? null);
      i18n.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('translations.title')}
        description={t('translations.description')}
        actions={
          <Button icon={<IconPlus />} onClick={() => setAdding(true)}>
            {t('translations.addLanguage')}
          </Button>
        }
      />
      {list.error || error ? (
        <Alert
          tone="error"
          action={
            list.error ? (
              <Button variant="secondary" onClick={list.reload}>
                {t('common.retry')}
              </Button>
            ) : undefined
          }
        >
          {errorMessage(list.error ?? error, t)}
        </Alert>
      ) : null}
      {list.loading && !list.data ? <LoadingBlock label={t('common.loading')} /> : null}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(list.data ?? []).map((language) => {
          const percent = language.total
            ? Math.floor((language.translated / language.total) * 100)
            : 0;
          return (
            <li key={language.code}>
              <Card className="h-full">
                <div className="flex h-full flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold" lang={language.code}>
                        {language.name}
                      </h2>
                      <p className="text-sm text-muted">
                        {language.englishName} · {language.code}
                        {language.bundled ? ` · ${t('translations.bundled')}` : ''}
                      </p>
                    </div>
                    <StatusChip tone={language.enabled ? 'success' : 'neutral'}>
                      {language.enabled ? t('translations.visible') : t('translations.hidden')}
                    </StatusChip>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm">
                      <span>
                        {t('translations.progress', {
                          translated: language.translated,
                          total: language.total,
                        })}
                      </span>
                      <span className="font-semibold">{percent}%</span>
                    </div>
                    <div
                      className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      aria-label={t('translations.progressLabel')}
                    >
                      <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
                    </div>
                    {language.overrides ? (
                      <p className="mt-1 text-sm text-muted">
                        {t('translations.changedHere', { count: language.overrides })}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
                    <ButtonLink href={`/admin/translations/${encodeURIComponent(language.code)}`}>
                      {t('translations.editTexts')}
                    </ButtonLink>
                    <Button
                      variant="secondary"
                      disabled={busy === language.code || (language.code === 'en' && language.enabled)}
                      onClick={() => toggle(language)}
                    >
                      {language.enabled ? t('translations.hide') : t('translations.show')}
                    </Button>
                    <Button
                      variant="ghost"
                      icon={<IconDownload />}
                      disabled={busy === language.code}
                      onClick={() => download(language)}
                    >
                      {t('translations.download')}
                    </Button>
                    {!language.bundled ? (
                      <Button
                        variant="ghost"
                        disabled={busy === language.code}
                        onClick={() => remove(language)}
                      >
                        {t('translations.delete')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      <Alert tone="info" title={t('translations.filesTitle')}>
        {t('translations.filesText')}
      </Alert>

      <AddLanguageDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(language) => {
          setAdding(false);
          list.setData((all) => [...(all ?? []), language]);
        }}
      />
    </div>
  );
}

function AddLanguageDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (language: AdminLanguageDto) => void;
}) {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [englishName, setEnglishName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const codeValid = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(code.trim().toLowerCase());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!codeValid || !name.trim() || !englishName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const language = await translationsAdminApi.createLanguage({
        code: code.trim().toLowerCase(),
        name: name.trim(),
        englishName: englishName.trim(),
      });
      setCode('');
      setName('');
      setEnglishName('');
      onAdded(language);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('translations.addLanguage')}
      description={t('translations.addLanguageHint')}
      closeLabel={t('translations.close')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          label={t('translations.code')}
          hint={t('translations.codeHint')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={code && !codeValid ? t('translations.codeInvalid') : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          required
        />
        <Field
          label={t('translations.nativeName')}
          hint={t('translations.nativeNameHint')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
        />
        <Field
          label={t('translations.englishName')}
          hint={t('translations.englishNameHint')}
          value={englishName}
          onChange={(e) => setEnglishName(e.target.value)}
          maxLength={60}
          required
        />
        {error ? <Alert tone="error">{errorMessage(error, t)}</Alert> : null}
        <Button
          type="submit"
          disabled={saving || !codeValid || !name.trim() || !englishName.trim()}
        >
          {saving ? t('translations.saving') : t('translations.addLanguage')}
        </Button>
      </form>
    </Dialog>
  );
}

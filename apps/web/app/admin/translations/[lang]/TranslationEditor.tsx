'use client';

import { checkTranslation, placeholders } from '@ap/i18n/core';
import type {
  AdminTranslationsDto,
  SaveTranslationsResultDto,
  TranslationEntryDto,
} from '@ap/contracts';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field, SelectField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconDownload } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { StickyActions } from '@/components/StickyActions';
import { translationsAdminApi } from '@/lib/i18n-api';
import { errorMessage, useApi } from '@/lib/useApi';
import { downloadFile, languageFile, parseLanguageFile } from '../files';

type Filter = 'all' | 'missing' | 'changed';
const PAGE = 40;

/** Every text of one language, searchable, editable in place, with file download/upload. */
export function TranslationEditor({ code }: { code: string }) {
  const i18n = useT();
  const { t } = i18n;
  const texts = useApi(`admin-texts-${code}`, (signal) =>
    translationsAdminApi.texts(code, { signal }),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveTranslationsResultDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);

  const data = texts.data;
  const sections = useMemo(
    () => [...new Set((data?.entries ?? []).map((e) => e.key.split('.')[0]!))].sort(),
    [data],
  );

  const visible = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.entries.filter((entry) => {
      if (section && !entry.key.startsWith(`${section}.`)) return false;
      const value = drafts[entry.key] ?? entry.override ?? entry.file ?? '';
      if (filter === 'missing' && value) return false;
      if (filter === 'changed' && entry.override === null && drafts[entry.key] === undefined)
        return false;
      if (!needle) return true;
      return (
        entry.key.toLowerCase().includes(needle) ||
        entry.reference.toLowerCase().includes(needle) ||
        value.toLowerCase().includes(needle)
      );
    });
  }, [data, query, section, filter, drafts]);

  const changes = Object.keys(drafts).length;

  const setDraft = (entry: TranslationEntryDto, value: string) => {
    setResult(null);
    setDrafts((all) => {
      const next = { ...all };
      const saved = entry.override ?? entry.file ?? '';
      if (value === saved) delete next[entry.key];
      else next[entry.key] = value;
      return next;
    });
  };

  const save = async () => {
    if (!changes) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await translationsAdminApi.save(code, { values: drafts });
      setResult(saved);
      const rejected = new Set(saved.rejected.map((r) => r.key));
      setDrafts((all) => Object.fromEntries(Object.entries(all).filter(([k]) => rejected.has(k))));
      texts.reload();
      i18n.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !data) return;
    setError(null);
    setResult(null);
    try {
      const values = parseLanguageFile(await file.text());
      const known = new Map(data.entries.map((e) => [e.key, e]));
      const next: Record<string, string> = { ...drafts };
      let count = 0;
      for (const [key, value] of Object.entries(values)) {
        const entry = known.get(key);
        if (!entry || value === (entry.override ?? entry.file ?? '')) continue;
        next[key] = value;
        count += 1;
      }
      setDrafts(next);
      setFilter('changed');
      setNotice(t('translations.uploaded', { count, name: file.name }));
    } catch {
      setNotice(null);
      setError(new Error(t('translations.uploadInvalid')));
    }
  };

  if (texts.error && !data) {
    return (
      <Alert
        tone="error"
        action={
          <Button variant="secondary" onClick={texts.reload}>
            {t('common.retry')}
          </Button>
        }
      >
        {errorMessage(texts.error, t)}
      </Alert>
    );
  }
  if (!data) return <LoadingBlock label={t('common.loading')} />;

  const { language } = data;
  const percent = language.total ? Math.floor((language.translated / language.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        backHref="/admin/translations"
        backLabel={t('translations.title')}
        title={t('translations.editorTitle', { name: language.name })}
        description={t('translations.editorDescription', {
          translated: language.translated,
          total: language.total,
          percent,
          example: '{amount}',
        })}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<IconDownload />}
              onClick={() =>
                downloadFile(
                  `${language.code}.json`,
                  languageFile(language, mergedEntries(data, drafts)),
                )
              }
            >
              {t('translations.download')}
            </Button>
            <Button variant="secondary" onClick={() => upload.current?.click()}>
              {t('translations.upload')}
            </Button>
            <input
              ref={upload}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onUpload}
            />
          </>
        }
      />
      {!language.enabled ? <Alert tone="warning">{t('translations.hiddenNotice')}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {error ? (
        <Alert tone="error">
          {error instanceof Error && !('status' in error) ? error.message : errorMessage(error, t)}
        </Alert>
      ) : null}
      {result ? (
        <Alert tone={result.rejected.length ? 'warning' : 'success'}>
          <p>{t('translations.saved', { count: result.saved + result.removed })}</p>
          {result.rejected.length ? (
            <ul className="mt-1 list-disc pl-5">
              {result.rejected.map((issue) => (
                <li key={issue.key}>
                  <code className="text-sm">{issue.key}</code>:{' '}
                  {i18n.tk(`translations.problem.${issue.problem}`, {
                    names: (issue.names ?? []).map((n) => `{${n}}`).join(', '),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Field
            label={t('translations.search')}
            type="search"
            value={query}
            placeholder={t('translations.searchPlaceholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
          />
          <SelectField
            label={t('translations.section')}
            value={section}
            onChange={(e) => {
              setSection(e.target.value);
              setShown(PAGE);
            }}
          >
            <option value="">{t('translations.allSections')}</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('translations.filterLabel')}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as Filter);
              setShown(PAGE);
            }}
          >
            <option value="all">{t('translations.filterAll')}</option>
            <option value="missing">{t('translations.filterMissing')}</option>
            <option value="changed">{t('translations.filterChanged')}</option>
          </SelectField>
        </div>
        <p className="mt-2 text-sm text-muted" aria-live="polite">
          {t('translations.found', { count: visible.length })}
        </p>
      </Card>

      <ul className="flex flex-col gap-3">
        {visible.slice(0, shown).map((entry) => (
          <EntryRow
            key={entry.key}
            entry={entry}
            lang={language.code}
            draft={drafts[entry.key]}
            onChange={(value) => setDraft(entry, value)}
          />
        ))}
      </ul>
      {visible.length > shown ? (
        <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
          {t('translations.showMore', { count: Math.min(PAGE, visible.length - shown) })}
        </Button>
      ) : null}

      {changes ? (
        <StickyActions>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={saving}>
              {saving
                ? t('translations.saving')
                : t('translations.saveChanges', { count: changes })}
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => setDrafts({})}>
              {t('translations.discard')}
            </Button>
          </div>
        </StickyActions>
      ) : null}
    </div>
  );
}

function mergedEntries(
  data: AdminTranslationsDto,
  drafts: Record<string, string>,
): TranslationEntryDto[] {
  return data.entries.map((entry) =>
    drafts[entry.key] !== undefined ? { ...entry, override: drafts[entry.key] || null } : entry,
  );
}

function EntryRow({
  entry,
  lang,
  draft,
  onChange,
}: {
  entry: TranslationEntryDto;
  lang: string;
  draft: string | undefined;
  onChange: (value: string) => void;
}) {
  const { t, tk } = useT();
  const value = draft ?? entry.override ?? entry.file ?? '';
  const issue = value ? checkTranslation(entry.key, value) : null;
  const variables = placeholders(entry.reference);
  const rows = Math.min(
    8,
    Math.max(2, Math.ceil(Math.max(value.length, entry.reference.length) / 60)),
  );
  const id = `text-${entry.key}`;

  return (
    <li>
      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="break-all text-xs text-muted">{entry.key}</code>
            <div className="flex gap-1.5">
              {draft !== undefined ? (
                <StatusChip tone="warning">{t('translations.unsaved')}</StatusChip>
              ) : entry.override !== null ? (
                <StatusChip tone="brand">{t('translations.changed')}</StatusChip>
              ) : !value ? (
                <StatusChip tone="danger">{t('translations.missing')}</StatusChip>
              ) : null}
            </div>
          </div>
          {lang !== 'en' ? (
            <p className="text-sm text-muted" lang="en">
              {entry.reference}
            </p>
          ) : null}
          <label htmlFor={id} className="visually-hidden">
            {entry.key}
          </label>
          <textarea
            id={id}
            lang={lang}
            value={value}
            rows={rows}
            placeholder={entry.file ?? entry.reference}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={issue && issue.problem !== 'missing_placeholder' ? true : undefined}
            className="min-h-12 w-full rounded-xl border border-line bg-bg px-3 py-2 text-base"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">
              {variables.length
                ? t('translations.variables', { names: variables.map((n) => `{${n}}`).join(' ') })
                : ''}
            </span>
            {entry.override !== null || draft !== undefined ? (
              <button
                type="button"
                className="min-h-10 rounded-lg px-2 font-semibold text-brand"
                onClick={() => onChange(entry.file ?? '')}
              >
                {t('translations.useFileText')}
              </button>
            ) : null}
          </div>
          {issue ? (
            <p
              className={
                issue.problem === 'missing_placeholder'
                  ? 'text-sm text-warning-fg'
                  : 'text-sm text-danger-fg'
              }
            >
              {tk(`translations.problem.${issue.problem}`, {
                names: (issue.names ?? []).map((n) => `{${n}}`).join(', '),
              })}
            </p>
          ) : null}
        </div>
      </Card>
    </li>
  );
}

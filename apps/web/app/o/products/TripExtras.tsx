'use client';

import {
  MAX_BOOKING_QUESTIONS,
  MAX_QUESTION_OPTIONS,
  type ProductDto,
  type ProductTranslation,
  type ProductTranslations,
} from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { ChoiceGroup, Field, SelectField, TextareaField } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { IconPlus, IconX } from '@/components/icons';
import { operatorApi } from '@/lib/endpoints';
import { bpsToPercentInput, percentToBps } from '@/lib/format';
import { BUNDLED_LANGUAGES } from '@/lib/i18n';
import { newQuestionId, parseOptions, translationProgress } from '@/lib/tripTranslations';
import { errorMessage } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

/**
 * What an operator adds to a trip beyond its prices and departures: a message and questions for
 * customers, the trip's texts in other languages, and a commission rate of its own. Trips from the
 * operator's own booking system take these too.
 */

function useSave(product: ProductDto, onSaved: (product: ProductDto) => void) {
  const i18n = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(body: Parameters<typeof operatorApi.updateProduct>[1]) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await operatorApi.updateProduct(product.id, body));
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save };
}

// --- Message and questions for customers --------------------------------------------------------

interface QuestionDraft {
  key: string;
  id: string;
  label: string;
  kind: 'text' | 'choice';
  required: boolean;
  /** One choice per line. */
  options: string;
}

function questionDraft(q?: ProductDto['questions'][number]): QuestionDraft {
  const id = q?.id ?? newQuestionId();
  return {
    key: id,
    id,
    label: q?.label ?? '',
    kind: q?.kind ?? 'text',
    required: q?.required ?? false,
    options: q ? q.options.map((o) => o.value).join('\n') : '',
  };
}

export function CustomerFieldsForm({
  product,
  onSaved,
}: {
  product: ProductDto;
  onSaved: (product: ProductDto) => void;
}) {
  const { t } = useT();
  const [note, setNote] = useState(product.customerNote ?? '');
  const [questions, setQuestions] = useState<QuestionDraft[]>(() =>
    product.questions.map((q) => questionDraft(q)),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, error, save } = useSave(product, onSaved);

  function update(key: string, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const body = questions.map((q) => {
      const options = q.kind === 'choice' ? parseOptions(q.options) : [];
      if (!q.label.trim()) next[q.key] = t('catalog.extras.errQuestionLabel');
      else if (q.kind === 'choice' && options.length < 2)
        next[q.key] = t('catalog.extras.errOptionsMin');
      else if (options.length > MAX_QUESTION_OPTIONS)
        next[q.key] = t('catalog.extras.errOptionsMax', { max: MAX_QUESTION_OPTIONS });
      else if (options.some((o) => o.length > 80))
        next[q.key] = t('catalog.extras.errOptionLength');
      return { id: q.id, label: q.label.trim(), kind: q.kind, required: q.required, options };
    });
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    await save({ customerNote: note.trim() || null, questions: body });
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <TextareaField
        label={t('catalog.extras.note')}
        hint={t('catalog.extras.noteHint')}
        name="customerNote"
        optionalText={t('common.optional')}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <fieldset className="min-w-0">
        <legend className="mb-1.5 font-semibold">{t('catalog.extras.questionsLegend')}</legend>
        <p className="mb-3 text-sm text-muted">{t('catalog.extras.questionsHelp')}</p>
        {questions.length === 0 ? (
          <p className="mb-2 text-sm text-muted">{t('catalog.extras.noQuestions')}</p>
        ) : null}
        <ol className="flex flex-col gap-3">
          {questions.map((q, index) => (
            <li key={q.key} className="flex flex-col gap-3 rounded-2xl border border-line p-3">
              <div className="-mb-2 -mt-1 flex items-center justify-between gap-2">
                <p className="font-bold">{t('catalog.extras.question', { number: index + 1 })}</p>
                <button
                  type="button"
                  className="-mr-1 inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2"
                  onClick={() => setQuestions((prev) => prev.filter((x) => x.key !== q.key))}
                  aria-label={t('catalog.extras.removeQuestion', { number: index + 1 })}
                >
                  <IconX />
                </button>
              </div>
              <Field
                label={t('catalog.extras.questionText')}
                hint={index === 0 ? t('catalog.extras.questionHint') : undefined}
                autoComplete="off"
                maxLength={200}
                value={q.label}
                onChange={(e) => update(q.key, { label: e.target.value })}
                error={errors[q.key]}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label={t('catalog.extras.answerKind')}
                  value={q.kind}
                  onChange={(e) => update(q.key, { kind: e.target.value as QuestionDraft['kind'] })}
                >
                  <option value="text">{t('catalog.extras.kindText')}</option>
                  <option value="choice">{t('catalog.extras.kindChoice')}</option>
                </SelectField>
                <label className="flex min-h-12 items-center gap-3 sm:mt-7">
                  <input
                    type="checkbox"
                    className="size-6 shrink-0"
                    checked={q.required}
                    onChange={(e) => update(q.key, { required: e.target.checked })}
                  />
                  <span>{t('catalog.extras.required')}</span>
                </label>
              </div>
              {q.kind === 'choice' ? (
                <TextareaField
                  label={t('catalog.extras.options')}
                  hint={t('catalog.extras.optionsHint')}
                  value={q.options}
                  onChange={(e) => update(q.key, { options: e.target.value })}
                />
              ) : null}
            </li>
          ))}
        </ol>
        <Button
          variant="ghost"
          icon={<IconPlus />}
          className="mt-2"
          onClick={() => setQuestions((prev) => [...prev, questionDraft()])}
          disabled={questions.length >= MAX_BOOKING_QUESTIONS}
        >
          {t('catalog.extras.addQuestion')}
        </Button>
      </fieldset>

      {product.translations && Object.keys(product.translations).length > 0 ? (
        <p className="text-sm text-muted">{t('catalog.extras.translateReminder')}</p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" loading={busy} loadingText={t('common.saving')}>
        {t('common.save')}
      </Button>
    </form>
  );
}

// --- Translations ---------------------------------------------------------------------------------

/** Only the texts the trip still has, so a deleted ticket type or question takes its translation with it. */
function forProduct(product: ProductDto, tr: ProductTranslation): ProductTranslation {
  const priceIds = new Set(product.prices.map((p) => p.id));
  const questionIds = new Set(product.questions.map((q) => q.id));
  return {
    ...tr,
    prices: Object.fromEntries(Object.entries(tr.prices ?? {}).filter(([id]) => priceIds.has(id))),
    questions: Object.fromEntries(
      Object.entries(tr.questions ?? {}).filter(([id]) => questionIds.has(id)),
    ),
  };
}

export function TranslationsForm({
  product,
  onSaved,
}: {
  product: ProductDto;
  onSaved: (product: ProductDto) => void;
}) {
  const { t } = useT();
  const { tenant } = useOperator();
  const languages = BUNDLED_LANGUAGES.filter((l) => l.code !== tenant.defaultLocale);
  const original = BUNDLED_LANGUAGES.find((l) => l.code === tenant.defaultLocale);
  const [drafts, setDrafts] = useState<ProductTranslations>(() => product.translations ?? {});
  const [lang, setLang] = useState(
    () => languages.find((l) => product.translations?.[l.code])?.code ?? languages[0]?.code ?? 'en',
  );
  const { busy, error, save } = useSave(product, onSaved);
  const draft = drafts[lang] ?? {};
  const progress = translationProgress(product, draft);

  function patch(change: (tr: ProductTranslation) => ProductTranslation) {
    setDrafts((prev) => ({ ...prev, [lang]: change(prev[lang] ?? {}) }));
  }
  const text = (key: 'name' | 'description' | 'meetingPoint' | 'customerNote', value: string) =>
    patch((tr) => ({ ...tr, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save({
      translations: Object.fromEntries(
        Object.entries(drafts).map(([code, tr]) => [code, forProduct(product, tr)]),
      ),
    });
  }

  const hint = (value: string) => t('catalog.extras.originalText', { text: value });

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {t('catalog.extras.translationsHelp', { language: original?.name ?? tenant.defaultLocale })}
      </p>
      <SelectField
        label={t('catalog.extras.language')}
        hint={t('catalog.extras.progress', { done: progress.done, total: progress.total })}
        value={lang}
        onChange={(e) => setLang(e.target.value)}
      >
        {languages.map((l) => {
          const p = translationProgress(product, drafts[l.code]);
          return (
            <option key={l.code} value={l.code}>
              {t('catalog.extras.languageOption', {
                language: l.name,
                done: p.done,
                total: p.total,
              })}
            </option>
          );
        })}
      </SelectField>

      <div key={lang} lang={lang} className="flex flex-col gap-4">
        <Field
          label={t('catalog.productForm.name')}
          hint={hint(product.name)}
          autoComplete="off"
          maxLength={120}
          value={draft.name ?? ''}
          onChange={(e) => text('name', e.target.value)}
        />
        {product.description ? (
          <TextareaField
            label={t('catalog.productForm.description')}
            hint={<Original text={product.description} />}
            maxLength={4000}
            value={draft.description ?? ''}
            onChange={(e) => text('description', e.target.value)}
          />
        ) : null}
        {product.meetingPoint ? (
          <Field
            label={t('catalog.productForm.meetingPoint')}
            hint={hint(product.meetingPoint)}
            autoComplete="off"
            maxLength={400}
            value={draft.meetingPoint ?? ''}
            onChange={(e) => text('meetingPoint', e.target.value)}
          />
        ) : null}
        {product.customerNote ? (
          <TextareaField
            label={t('catalog.extras.note')}
            hint={<Original text={product.customerNote} />}
            maxLength={1000}
            value={draft.customerNote ?? ''}
            onChange={(e) => text('customerNote', e.target.value)}
          />
        ) : null}

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1.5 font-semibold">{t('catalog.extras.ticketNames')}</legend>
          {product.prices.map((price) => (
            <Field
              key={price.id}
              label={price.label}
              autoComplete="off"
              maxLength={80}
              value={draft.prices?.[price.id] ?? ''}
              onChange={(e) =>
                patch((tr) => ({ ...tr, prices: { ...tr.prices, [price.id]: e.target.value } }))
              }
            />
          ))}
        </fieldset>

        {product.questions.map((q, index) => {
          const qt = draft.questions?.[q.id];
          const setQuestion = (change: { label?: string; options?: string[] }) =>
            patch((tr) => ({
              ...tr,
              questions: { ...tr.questions, [q.id]: { ...tr.questions?.[q.id], ...change } },
            }));
          return (
            <fieldset key={q.id} className="flex min-w-0 flex-col gap-3">
              <legend className="mb-1.5 font-semibold">
                {t('catalog.extras.question', { number: index + 1 })}
              </legend>
              <Field
                label={t('catalog.extras.questionText')}
                hint={hint(q.label)}
                autoComplete="off"
                maxLength={200}
                value={qt?.label ?? ''}
                onChange={(e) => setQuestion({ label: e.target.value })}
              />
              {q.options.map((option, i) => (
                <Field
                  key={option.value}
                  label={option.value}
                  autoComplete="off"
                  maxLength={80}
                  value={qt?.options?.[i] ?? ''}
                  onChange={(e) => {
                    const options = q.options.map((_, j) => qt?.options?.[j] ?? '');
                    options[i] = e.target.value;
                    setQuestion({ options });
                  }}
                />
              ))}
            </fieldset>
          );
        })}
      </div>

      <p className="text-sm text-muted">{t('catalog.extras.untranslatedNote')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" loading={busy} loadingText={t('common.saving')}>
        {t('catalog.extras.saveTranslations')}
      </Button>
    </form>
  );
}

/** A long original text, shown in full but clamped so the field below stays in view. */
function Original({ text }: { text: string }) {
  const { t } = useT();
  return (
    <span className="line-clamp-3 whitespace-pre-line">
      {t('catalog.extras.originalText', { text })}
    </span>
  );
}

// --- Commission -----------------------------------------------------------------------------------

export function TripCommissionForm({
  product,
  onSaved,
}: {
  product: ProductDto;
  onSaved: (product: ProductDto) => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<'plan' | 'own'>(
    product.commissionRateBps === null ? 'plan' : 'own',
  );
  const [rate, setRate] = useState(
    product.commissionRateBps === null ? '' : bpsToPercentInput(product.commissionRateBps),
  );
  const [rateError, setRateError] = useState<string | null>(null);
  const { busy, error, save } = useSave(product, onSaved);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'plan') {
      setRateError(null);
      await save({ commissionRateBps: null });
      return;
    }
    const bps = percentToBps(rate);
    if (bps === null) {
      setRateError(t('catalog.extras.errRate'));
      return;
    }
    setRateError(null);
    await save({ commissionRateBps: bps });
  }

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
      <ChoiceGroup
        legend={t('catalog.extras.commissionLegend')}
        name="commission-mode"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: 'plan',
            label: t('catalog.extras.commissionPlan'),
            description: t('catalog.extras.commissionPlanHelp'),
          },
          {
            value: 'own',
            label: t('catalog.extras.commissionOwn'),
            description: t('catalog.extras.commissionOwnHelp'),
          },
        ]}
      />
      {mode === 'own' ? (
        <Field
          label={t('catalog.extras.rate')}
          inputMode="decimal"
          autoComplete="off"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          error={rateError ?? undefined}
          className="max-w-xs"
        />
      ) : null}
      <p className="text-sm text-muted">{t('catalog.extras.commissionNote')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" loading={busy} loadingText={t('common.saving')}>
        {t('common.save')}
      </Button>
    </form>
  );
}

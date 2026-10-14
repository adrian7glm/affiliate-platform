'use client';

import type { DiscountPreviewDto } from '@ap/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { discountErrorKey, discountText, normalizeCode } from '@/lib/discounts';
import { publicApi } from '@/lib/endpoints';
import type { Translator } from '@/lib/i18n';
import { Button } from '../Button';
import { INPUT_CLASSES } from '../Field';
import { useT } from '../I18nProvider';
import { IconAlert, IconCheck, IconTag, IconX } from '../icons';

interface DiscountCodeFieldProps {
  tenantSlug: string;
  productId: string;
  currency: string;
  applied: DiscountPreviewDto | null;
  onApplied: (code: DiscountPreviewDto | null) => void;
  /** A code to try at once (from the page address). */
  initialCode?: string | null;
  /** Codes to offer with one tap (an affiliate's own). */
  suggestions?: DiscountPreviewDto[];
  t?: Translator;
}

/**
 * "Have a discount code?": checks the code for the trip and shows what it takes off. It sits
 * inside the booking form, so Enter applies the code instead of sending the booking.
 */
export function DiscountCodeField({
  tenantSlug,
  productId,
  currency,
  applied,
  onApplied,
  initialCode,
  suggestions = [],
  t: given,
}: DiscountCodeFieldProps) {
  const current = useT();
  const t = given ?? current;
  const id = useId();
  const [open, setOpen] = useState(Boolean(initialCode));
  const [text, setText] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef<string | null>(null);

  async function apply(raw: string) {
    const code = normalizeCode(raw);
    if (!code) return setError(t.t('public.discount.empty'));
    setBusy(true);
    setError(null);
    try {
      onApplied(await publicApi.discount(tenantSlug, code, productId, { lang: t.lang }));
      setText(code);
    } catch (err) {
      const key = discountErrorKey(err);
      setError(key ? t.t(key) : t.t('common.errorGeneric'));
      onApplied(null);
    } finally {
      setBusy(false);
    }
  }

  // A code from the address is tried once per trip.
  useEffect(() => {
    if (!initialCode || tried.current === productId) return;
    tried.current = productId;
    void apply(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode, productId]);

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-success/40 bg-success-soft px-4 py-3 text-success-fg">
        <p className="flex min-w-0 items-center gap-2 font-semibold">
          <IconCheck className="shrink-0" />
          <span className="min-w-0 break-words">
            {t.t('public.discount.applied', {
              code: applied.code,
              discount: discountText(applied, currency, t.lang),
            })}
          </span>
        </p>
        <button
          type="button"
          className="-my-2 -mr-2 inline-flex size-12 shrink-0 items-center justify-center rounded-xl hover:bg-success/10"
          aria-label={t.t('public.discount.remove')}
          title={t.t('public.discount.remove')}
          onClick={() => {
            onApplied(null);
            setText('');
            setError(null);
          }}
        >
          <IconX />
        </button>
      </div>
    );
  }

  if (!open && suggestions.length === 0) {
    return (
      <Button
        variant="ghost"
        icon={<IconTag />}
        className="self-start px-3"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        {t.t('public.discount.question')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {t.t('public.discount.label')}
      </label>
      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label={t.t('public.discount.yourCodes')}>
          {suggestions.map((s) => (
            <Button
              key={s.code}
              variant="secondary"
              className="min-h-11 px-3 py-1.5 text-base"
              disabled={busy}
              onClick={() => void apply(s.code)}
            >
              <span className="font-mono">{s.code}</span>
              <span className="font-normal text-muted">{discountText(s, currency, t.lang)}</span>
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <input
          id={id}
          className={`${INPUT_CLASSES} min-w-0 flex-1 font-mono uppercase`}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={24}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply(text);
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button variant="secondary" loading={busy} onClick={() => void apply(text)}>
          {t.t('public.discount.apply')}
        </Button>
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-sm font-medium text-danger-fg"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

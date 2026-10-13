import type {
  BookingQuestionDto,
  ProductTranslation,
  ProductTranslations,
  UpdateProductBody,
} from '@ap/contracts';
import type { BookingQuestion } from '@ap/db';

/**
 * A trip's texts in the customer's language. Operators write their trips in their own language and
 * may translate them; whatever is not translated shows in the operator's language, so a customer
 * never sees an empty name or a missing ticket type.
 */

/** The translation for a language: "pt-br", else "pt". Null when there is none. */
export function translationFor(
  translations: ProductTranslations,
  lang: string | null | undefined,
): ProductTranslation | null {
  if (!lang) return null;
  const code = lang.toLowerCase();
  return translations[code] ?? translations[code.split('-')[0]!] ?? null;
}

export interface TripTexts {
  name: string;
  description: string | null;
  meetingPoint: string | null;
  customerNote: string | null;
}

export function localizedTexts(
  product: TripTexts & { translations: ProductTranslations },
  lang: string | null | undefined,
): TripTexts {
  const tr = translationFor(product.translations, lang);
  return {
    name: tr?.name || product.name,
    // A text the operator left empty stays empty in every language.
    description: product.description ? tr?.description || product.description : null,
    meetingPoint: product.meetingPoint ? tr?.meetingPoint || product.meetingPoint : null,
    customerNote: product.customerNote ? tr?.customerNote || product.customerNote : null,
  };
}

export function localizedPriceLabel(
  translations: ProductTranslations,
  lang: string | null | undefined,
  priceId: string,
  label: string,
): string {
  return translationFor(translations, lang)?.prices?.[priceId] || label;
}

export function localizedQuestions(
  questions: BookingQuestion[],
  translations: ProductTranslations,
  lang: string | null | undefined,
): BookingQuestionDto[] {
  const tr = translationFor(translations, lang);
  return questions.map((q) => {
    const qt = tr?.questions?.[q.id];
    // Translated choices only count when they still match the operator's list one to one.
    const options = qt?.options?.length === q.options.length ? qt.options : null;
    return {
      id: q.id,
      label: qt?.label || q.label,
      kind: q.kind,
      required: q.required,
      options: q.options.map((value, i) => ({ value, label: options?.[i] || value })),
    };
  });
}

/** Drops empty texts and languages left with nothing, so "not translated" has one shape. */
export function cleanTranslations(
  input: NonNullable<UpdateProductBody['translations']>,
): ProductTranslations {
  const out: ProductTranslations = {};
  for (const [lang, tr] of Object.entries(input)) {
    const clean: ProductTranslation = {};
    for (const key of ['name', 'description', 'meetingPoint', 'customerNote'] as const) {
      if (tr[key]) clean[key] = tr[key];
    }
    const prices = Object.fromEntries(Object.entries(tr.prices ?? {}).filter(([, v]) => v));
    if (Object.keys(prices).length) clean.prices = prices;
    const questions: NonNullable<ProductTranslation['questions']> = {};
    for (const [id, q] of Object.entries(tr.questions ?? {})) {
      const entry: { label?: string; options?: string[] } = {};
      if (q.label) entry.label = q.label;
      if (q.options?.some(Boolean)) entry.options = q.options;
      if (Object.keys(entry).length) questions[id] = entry;
    }
    if (Object.keys(questions).length) clean.questions = questions;
    if (Object.keys(clean).length) out[lang] = clean;
  }
  return out;
}

import type { ProductDto, ProductTranslation } from '@ap/contracts';

/** The texts of a trip that can be translated, and how many of them a translation covers. */
export function translationProgress(
  product: Pick<
    ProductDto,
    'description' | 'meetingPoint' | 'customerNote' | 'prices' | 'questions'
  >,
  translation: ProductTranslation | undefined,
): { done: number; total: number } {
  const has = (text: string | undefined) => (text?.trim() ? 1 : 0);
  let total = 1;
  let done = has(translation?.name);
  for (const key of ['description', 'meetingPoint', 'customerNote'] as const) {
    if (!product[key]) continue;
    total += 1;
    done += has(translation?.[key]);
  }
  for (const price of product.prices) {
    total += 1;
    done += has(translation?.prices?.[price.id]);
  }
  for (const question of product.questions) {
    const qt = translation?.questions?.[question.id];
    total += 1 + question.options.length;
    done += has(qt?.label);
    // Choices only count as translated when they still match the operator's list one to one.
    if (qt?.options?.length === question.options.length) {
      done += qt.options.filter((o) => o.trim()).length;
    }
  }
  return { done, total };
}

/** Languages a trip is fully or partly translated into, by code. */
export function translatedLanguages(product: Pick<ProductDto, 'translations'>): string[] {
  return Object.entries(product.translations ?? {})
    .filter(([, tr]) =>
      Object.values(tr).some((v) => (typeof v === 'string' ? v.trim() : Object.keys(v).length)),
    )
    .map(([code]) => code)
    .sort();
}

/** A short random id for a new booking question (a-z0-9, as the API expects). */
export function newQuestionId(random: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(random() * chars.length)]).join('');
}

/** Choices typed one per line: trimmed, without blanks and repeats (ignoring case). */
export function parseOptions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const option = line.trim();
    if (!option || seen.has(option.toLowerCase())) continue;
    seen.add(option.toLowerCase());
    out.push(option);
  }
  return out;
}

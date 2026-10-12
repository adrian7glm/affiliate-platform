import { LOCALE_FILES } from './catalog';
import { registerLocale } from './core';

/** Everything in `./core`, with every language file loaded (API, emails, server pages). */
export * from './core';

for (const [code, tree] of Object.entries(LOCALE_FILES)) registerLocale(code, tree);

/** The whole file of a bundled language, e.g. to hand one language to the browser. */
export function localeFile(code: string): Readonly<Record<string, unknown>> | null {
  return (LOCALE_FILES as Record<string, Record<string, unknown>>)[code] ?? null;
}

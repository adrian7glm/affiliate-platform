import { Fragment, type ReactNode } from 'react';

/**
 * Puts elements (a bold name, a formatted amount) inside one translated sentence, so the
 * sentence stays a single key: `t(key, { ...slots('name'), period })` then
 * `<Rich text={...} parts={{ name: <strong>…</strong> }} />`.
 */
const MARK = '\u0000';

export function slots<K extends string>(...names: K[]): Record<K, string> {
  return Object.fromEntries(names.map((n) => [n, `${MARK}${n}${MARK}`])) as Record<K, string>;
}

export function Rich({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  const pieces = text.split(new RegExp(`${MARK}(\\w+)${MARK}`));
  return (
    <>
      {pieces.map((piece, i) =>
        i % 2 === 1 ? <Fragment key={i}>{parts[piece]}</Fragment> : piece,
      )}
    </>
  );
}

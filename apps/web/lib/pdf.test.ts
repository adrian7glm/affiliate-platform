import { describe, expect, it } from 'vitest';
import { jpegPdf } from './pdf';

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('jpegPdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = latin1(jpegPdf(jpeg, { width: 2480, height: 3508 }, { w: 210, h: 297 }));

  it('sizes the page in points and embeds the JPEG untouched', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(pdf).toContain('/Width 2480 /Height 3508');
    expect(pdf).toContain(`/Length ${jpeg.length} >>\nstream\n${latin1(jpeg)}\nendstream`);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
  });

  it('has a cross-reference table that points at each object', () => {
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...pdf.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) =>
      Number(m[1]),
    );
    expect(entries).toHaveLength(5);
    entries.forEach((offset, i) => {
      expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });
});

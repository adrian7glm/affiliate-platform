/**
 * A one-page PDF holding a single JPEG that fills the page. Enough for print-ready QR
 * materials without a PDF library: the JPEG goes in as-is (DCTDecode), so the file is the
 * image plus about 700 bytes.
 */
export function jpegPdf(
  jpeg: Uint8Array,
  image: { width: number; height: number },
  pageMm: { w: number; h: number },
): Uint8Array {
  const pt = (mm: number) => ((mm * 72) / 25.4).toFixed(2);
  const W = pt(pageMm.w);
  const H = pt(pageMm.h);
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (body: string, stream?: Uint8Array) => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  push('%PDF-1.4\n');
  // A comment with high bytes marks the file as binary for transfer tools.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  );
  object(
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  );
  const content = encoder.encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
  object(`<< /Length ${content.length} >>`, content);

  const xref = length;
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

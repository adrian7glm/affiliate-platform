/** Builds and downloads CSV files in the browser. */

export type CsvCell = string | number | null | undefined;

export function csvEscape(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

/** Triggers a download. A UTF-8 BOM keeps diacritics intact when the file is opened in Excel. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Minor units → plain decimal string for spreadsheets ("1234.50"). */
export function minorToCsvAmount(amountMinor: number, digits = 2): string {
  return (amountMinor / 10 ** digits).toFixed(digits);
}

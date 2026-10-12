/**
 * Phone and email helpers matching the API validation rules in @ap/contracts:
 * phones are international (+40722123456), emails are trimmed and lower-cased.
 */

const PHONE_RE = /^\+[1-9]\d{6,14}$/;
// Same shape the API accepts; deliberately permissive.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalizes what a person typed into an international phone number:
 * strips spaces, dashes, dots and brackets; "00…" → "+…"; Romanian national "07…" → "+407…".
 */
export function normalizePhone(input: string, defaultCountryCode = '40'): string {
  let value = input.trim().replace(/[\s\-().]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (!value.startsWith('+') && /^0\d{9}$/.test(value))
    value = `+${defaultCountryCode}${value.slice(1)}`;
  return value;
}

export function isValidPhone(value: string): boolean {
  return PHONE_RE.test(value);
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

/** Digits only, for wa.me links. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Masks a destination for display after the code is sent: "+40 7•• ••• 456" / "an•••@gmail.com". */
export function maskDestination(destination: string): string {
  if (destination.includes('@')) {
    const [user = '', domain = ''] = destination.split('@');
    const visible = user.slice(0, 2);
    return `${visible}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
  }
  if (destination.length <= 6) return destination;
  return `${destination.slice(0, 4)}${'•'.repeat(destination.length - 7)}${destination.slice(-3)}`;
}

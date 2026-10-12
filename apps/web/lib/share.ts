import { phoneDigits } from './contact';

/** Copies text to the clipboard. Falls back to a hidden textarea where the async API is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path (e.g. permission denied in an insecure context).
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Opens the native share sheet. Returns false when unsupported or dismissed. */
export async function shareLink(data: {
  title?: string;
  text?: string;
  url: string;
}): Promise<boolean> {
  if (!canShare()) return false;
  try {
    await navigator.share(data);
    return true;
  } catch {
    return false;
  }
}

/** wa.me link; with a phone number it opens that chat directly. */
export function whatsappUrl(message: string, phone?: string | null): string {
  const digits = phone ? phoneDigits(phone) : '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** sms: link with a prefilled body. `?&body=` works on both iOS and Android. */
export function smsUrl(message: string, phone?: string | null): string {
  return `sms:${phone ?? ''}?&body=${encodeURIComponent(message)}`;
}

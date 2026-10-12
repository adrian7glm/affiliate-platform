/**
 * Reads QR codes from a playing <video>. Uses the native BarcodeDetector where it supports
 * QR codes (Chromium on Android and macOS); everywhere else it lazy-loads jsQR and decodes a
 * downscaled canvas frame.
 */
export type QrDecoder = (video: HTMLVideoElement) => Promise<string | null>;

export type DecoderKind = 'native' | 'jsqr';

/** Longest edge of the frame handed to jsQR: big enough for a phone screen at arm's length. */
const MAX_EDGE = 720;

export async function createQrDecoder(): Promise<{ kind: DecoderKind; decode: QrDecoder }> {
  const Native = typeof window !== 'undefined' ? window.BarcodeDetector : undefined;
  if (Native) {
    try {
      const formats = await Native.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const detector = new Native({ formats: ['qr_code'] });
        return {
          kind: 'native',
          decode: async (video) => {
            const codes = await detector.detect(video);
            return codes.find((c) => c.rawValue)?.rawValue ?? null;
          },
        };
      }
    } catch {
      // Fall through to jsQR.
    }
  }

  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return {
    kind: 'jsqr',
    decode: async (video) => {
      if (!context || !video.videoWidth || !video.videoHeight) return null;
      const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      return jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    },
  };
}

/** True for strings that can be a signed ticket token (the check-in endpoint wants ≥ 16 chars). */
export function looksLikeToken(value: string): boolean {
  return value.length >= 16 && value.length <= 2000 && !/\s/.test(value);
}

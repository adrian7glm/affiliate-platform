/// <reference types="next" />
/// <reference types="next/image-types/global" />

/**
 * Minimal typings for the Shape Detection API (`BarcodeDetector`), which is not part of the
 * TypeScript DOM lib yet. Only what the ticket scanner uses.
 */
interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<string[]>;
  detect(source: CanvasImageSource | ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}

/** WebOTP: `navigator.credentials.get({ otp })`. */
interface OTPCredential extends Credential {
  readonly code: string;
}

interface CredentialRequestOptions {
  otp?: { transport: string[] };
}

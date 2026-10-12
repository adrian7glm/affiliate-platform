import type { BookingDto, LinkDto, ProductDto, PublicCheckoutBody } from '@ap/contracts';

/**
 * Contract additions made upstream after this app was branched:
 * - LinkDto.qrUrl and PublicCheckoutBody.refSource (QR vs link attribution),
 * - availability sources (the operator's own booking system): ConnectSourceBody, SourceDto,
 *   SyncResultDto, ProductDto.managedExternally and BookingDto.externalRef.
 * Declared here (fields optional where they extend existing DTOs) so the web app compiles
 * against either version of @ap/contracts; once the package has them these are no-ops.
 */

export type RefSource = 'qr' | 'link';

/** `qrUrl` is the link URL marked as a QR scan (`?s=qr`); QR codes encode it. */
export type LinkWithQr = LinkDto & { qrUrl?: string };

export type CheckoutBody = PublicCheckoutBody & { refSource?: RefSource };

/** URL to encode in a QR code for this link (copy/share keep using `link.url`). */
export function linkQrUrl(link: LinkDto): string {
  const withQr = link as LinkWithQr;
  if (withQr.qrUrl) return withQr.qrUrl;
  return `${link.url}${link.url.includes('?') ? '&' : '?'}s=qr`;
}

export interface ConnectSourceBody {
  name: string;
  /** Base URL (http/https) of the operator's API. */
  baseUrl: string;
  token: string;
}

export interface SourceDto {
  id: string;
  kind: 'internal' | 'rest';
  name: string;
  baseUrl: string | null;
  active: boolean;
  lastSyncedAt: string | null;
  productCount: number;
}

export interface SyncResultDto {
  products: number;
  slots: number;
}

/** True when prices and departures come from the operator's own system (read-only here). */
export function isManagedExternally(product: ProductDto): boolean {
  return (product as ProductDto & { managedExternally?: boolean }).managedExternally === true;
}

/** The booking's reference in the operator's own system, if any. */
export function externalRef(booking: BookingDto): string | null {
  return (booking as BookingDto & { externalRef?: string | null }).externalRef ?? null;
}

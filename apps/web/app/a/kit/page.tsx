import type { Metadata } from 'next';
import { KitScreen } from './KitScreen';

export const metadata: Metadata = { title: 'Kit QR de tipărit' };

export default async function KitPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; format?: string }>;
}) {
  const { link, format } = await searchParams;
  return <KitScreen linkId={link} format={format} />;
}

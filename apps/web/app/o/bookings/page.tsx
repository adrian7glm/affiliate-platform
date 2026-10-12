import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { BookingsScreen } from './BookingsScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('operator.nav.bookings') };
}

export default function BookingsPage() {
  return <BookingsScreen />;
}

import type { Metadata } from 'next';
import { BookingsScreen } from './BookingsScreen';

export const metadata: Metadata = { title: 'Rezervări' };

export default function BookingsPage() {
  return <BookingsScreen />;
}

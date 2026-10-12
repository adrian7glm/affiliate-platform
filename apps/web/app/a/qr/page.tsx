import type { Metadata } from 'next';
import { QrScreen } from './QrScreen';

export const metadata: Metadata = { title: 'Codul meu QR' };

export default function QrPage() {
  return <QrScreen />;
}

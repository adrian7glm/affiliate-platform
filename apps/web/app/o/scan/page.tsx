import type { Metadata } from 'next';
import { ScanScreen } from './ScanScreen';

export const metadata: Metadata = { title: 'Scanează bilete' };

export default function ScanPage() {
  return <ScanScreen />;
}

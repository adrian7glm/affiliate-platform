import type { Metadata } from 'next';
import { BOARDING_TEXT } from '@/lib/boarding-text';
import { OperatorScan } from './OperatorScan';

export const metadata: Metadata = { title: BOARDING_TEXT.scanTitle };

export default function ScanPage() {
  return <OperatorScan />;
}

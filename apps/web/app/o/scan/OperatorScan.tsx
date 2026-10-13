'use client';

import { ScanScreen } from '@/components/scanner/ScanScreen';
import { useOperator } from '../OperatorContext';

export function OperatorScan() {
  const { tenant } = useOperator();
  return <ScanScreen tenant={tenant} />;
}

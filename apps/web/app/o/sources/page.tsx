import type { Metadata } from 'next';
import { SourcesScreen } from './SourcesScreen';

export const metadata: Metadata = { title: 'Sistemul tău de rezervări' };

export default function SourcesPage() {
  return <SourcesScreen />;
}

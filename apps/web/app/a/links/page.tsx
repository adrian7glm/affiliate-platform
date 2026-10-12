import type { Metadata } from 'next';
import { LinksScreen } from './LinksScreen';

export const metadata: Metadata = { title: 'Linkurile mele' };

export default function LinksPage() {
  return <LinksScreen />;
}

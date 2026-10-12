import type { Metadata } from 'next';
import { AffiliateHome } from './AffiliateHome';

export const metadata: Metadata = { title: 'Acasă' };

export default function AffiliateHomePage() {
  return <AffiliateHome />;
}

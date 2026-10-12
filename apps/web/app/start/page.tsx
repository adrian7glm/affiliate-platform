import type { Metadata } from 'next';
import { StartFlow } from './StartFlow';

export const metadata: Metadata = {
  title: 'Deschide cont de operator',
  description: 'Rețeaua ta de afiliați pentru excursii: începe gratuit, fără card.',
};

export default function StartPage() {
  return <StartFlow token={null} />;
}

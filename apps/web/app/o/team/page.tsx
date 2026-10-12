import type { Metadata } from 'next';
import { BOARDING_TEXT } from '@/lib/boarding-text';
import { TeamScreen } from './TeamScreen';

export const metadata: Metadata = { title: BOARDING_TEXT.teamTitle };

export default function TeamPage() {
  return <TeamScreen />;
}

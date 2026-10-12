import type { Metadata } from 'next';
import { SettingsScreen } from './SettingsScreen';

export const metadata: Metadata = { title: 'Setări și aspect' };

export default function SettingsPage() {
  return <SettingsScreen />;
}

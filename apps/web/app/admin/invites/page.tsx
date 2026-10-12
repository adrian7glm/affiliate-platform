import type { Metadata } from 'next';
import { InvitesAdmin } from './InvitesAdmin';

export const metadata: Metadata = { title: 'Invitații' };

export default function AdminInvitesPage() {
  return <InvitesAdmin />;
}

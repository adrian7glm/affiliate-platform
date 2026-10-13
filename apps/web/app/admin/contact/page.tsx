import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { ContactAdmin } from './ContactAdmin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('admin.contact.title') };
}

export default function AdminContactPage() {
  return <ContactAdmin />;
}

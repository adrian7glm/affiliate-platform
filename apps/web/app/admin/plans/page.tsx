import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { PlansAdmin } from './PlansAdmin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('admin.plans.title') };
}

export default function AdminPlansPage() {
  return <PlansAdmin />;
}

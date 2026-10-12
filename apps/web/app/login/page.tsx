import type { Metadata } from 'next';
import { LoginFlow } from './LoginFlow';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('auth.meta.login') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : null;
  const reason = typeof params.reason === 'string' ? params.reason : null;
  return <LoginFlow next={next} reason={reason} />;
}

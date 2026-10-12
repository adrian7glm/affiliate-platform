import type { Metadata } from 'next';
import { LoginFlow } from './LoginFlow';

export const metadata: Metadata = { title: 'Intră în cont' };

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

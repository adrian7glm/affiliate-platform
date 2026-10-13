import { ButtonLink } from '@/components/Button';
import { getServerT, serverLang } from '@/lib/i18n-server';

export default async function NotFound() {
  const { t } = await getServerT(await serverLang());
  return (
    <main className="page-x mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 py-10">
      <p className="text-5xl font-extrabold text-brand">404</p>
      <h1 className="text-2xl font-bold">{t('common.pageNotFound')}</h1>
      <ButtonLink href="/" size="lg">
        {t('common.goHome')}
      </ButtonLink>
    </main>
  );
}

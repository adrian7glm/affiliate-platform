import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClasses } from '@/components/Button';
import { PublicMessage, PublicShell } from '@/components/public/PublicShell';
import { formatMoney } from '@/lib/format';
import { formatDuration } from '@/lib/i18n';
import { getServerT } from '@/lib/i18n-server';
import { loadTenant, requestLang, withLang } from '@/lib/public-server';

interface Props {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ tenant: slug }, query] = await Promise.all([params, searchParams]);
  const lang = await requestLang(query.lang);
  const tenant = await loadTenant(slug, lang);
  if (!tenant.ok) {
    const { t } = await getServerT(lang);
    return { title: t('public.notFoundTitle'), robots: { index: false } };
  }
  return {
    title: { absolute: tenant.data.name },
    description: tenant.data.products.map((p) => p.name).join(' · '),
  };
}

/** The operator's public page: every bookable trip, opened from an affiliate link or directly. */
export default async function TenantPage({ params, searchParams }: Props) {
  const [{ tenant: slug }, query] = await Promise.all([params, searchParams]);
  const lang = await requestLang(query.lang);
  const { t } = await getServerT(lang);
  const path = `/b/${encodeURIComponent(slug)}`;
  const tenant = await loadTenant(slug, lang);

  if (!tenant.ok) {
    return (
      <PublicShell lang={lang} path={path}>
        <PublicMessage
          title={tenant.notFound ? t('public.tenantNotFound') : t('common.errorGeneric')}
        >
          {!tenant.notFound ? (
            <a href={withLang(path, lang)} className={buttonClasses('secondary')}>
              {t('common.retry')}
            </a>
          ) : null}
        </PublicMessage>
      </PublicShell>
    );
  }

  const { data } = tenant;
  return (
    <PublicShell lang={lang} path={path} tenantName={data.name} branding={data.branding}>
      <h1 className="pb-4 pt-6 text-2xl font-bold sm:text-3xl">{t('public.productsTitle')}</h1>
      {data.products.length === 0 ? <p className="text-muted">{t('public.noProducts')}</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {data.products.map((product) => {
          const href = withLang(`${path}/${encodeURIComponent(product.slug)}`, lang);
          const image = product.images.find((src) => /^https:\/\//.test(src));
          return (
            <li key={product.id}>
              <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-surface">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-[16/9] w-full object-cover"
                  />
                ) : null}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h2 className="text-lg font-semibold">
                    <Link href={href} className="hover:underline">
                      {product.name}
                    </Link>
                  </h2>
                  {product.description ? (
                    <p className="line-clamp-3 text-muted">{product.description}</p>
                  ) : null}
                  <p className="text-sm text-muted">
                    {t('public.durationValue', {
                      duration: formatDuration(product.durationMinutes, lang),
                    })}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                    <p className="font-semibold">
                      {t('public.fromPrice', {
                        price: formatMoney(product.fromMinor, product.currency, lang),
                      })}
                    </p>
                    <Link
                      href={href}
                      className={buttonClasses('primary')}
                      aria-label={t('public.bookTrip', { name: product.name })}
                    >
                      {t('public.book')}
                    </Link>
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </PublicShell>
  );
}

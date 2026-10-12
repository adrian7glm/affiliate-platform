import type { Metadata } from 'next';
import { buttonClasses } from '@/components/Button';
import { PublicMessage, PublicShell } from '@/components/public/PublicShell';
import { formatMoney } from '@/lib/format';
import { formatDuration, getT } from '@/lib/i18n';
import { loadProduct, loadTenant, requestLang, withLang } from '@/lib/public-server';
import { PublicBookingForm } from './PublicBookingForm';

interface Props {
  params: Promise<{ tenant: string; product: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant: slug, product: productSlug } = await params;
  const [tenant, product] = await Promise.all([loadTenant(slug), loadProduct(slug, productSlug)]);
  if (!tenant.ok || !product.ok) return { title: 'Not found', robots: { index: false } };
  return {
    title: { absolute: `${product.data.name} · ${tenant.data.name}` },
    description: product.data.description?.slice(0, 200) ?? undefined,
  };
}

/** One trip: details and the booking form (date, time, tickets, contact, pay). */
export default async function ProductPage({ params, searchParams }: Props) {
  const [{ tenant: slug, product: productSlug }, query] = await Promise.all([params, searchParams]);
  const lang = await requestLang(query.lang);
  const { t } = getT(lang);
  const tenantPath = `/b/${encodeURIComponent(slug)}`;
  const path = `${tenantPath}/${encodeURIComponent(productSlug)}`;
  const [tenant, product] = await Promise.all([loadTenant(slug), loadProduct(slug, productSlug)]);

  if (!tenant.ok || !product.ok) {
    const notFound = (!tenant.ok && tenant.notFound) || (!product.ok && product.notFound);
    return (
      <PublicShell
        lang={lang}
        path={path}
        tenantName={tenant.ok ? tenant.data.name : null}
        branding={tenant.ok ? tenant.data.branding : null}
        homeHref={tenant.ok ? withLang(tenantPath, lang) : undefined}
      >
        <PublicMessage title={notFound ? t('productNotFound') : t('errorGeneric')}>
          {tenant.ok ? (
            <a href={withLang(tenantPath, lang)} className={buttonClasses('secondary')}>
              {t('productsTitle')}
            </a>
          ) : null}
        </PublicMessage>
      </PublicShell>
    );
  }

  const trip = product.data;
  const image = trip.images.find((src) => /^https:\/\//.test(src));

  return (
    <PublicShell
      lang={lang}
      path={path}
      tenantName={tenant.data.name}
      branding={tenant.data.branding}
      homeHref={withLang(tenantPath, lang)}
    >
      <article className="flex flex-col gap-6 pt-5">
        <header className="flex flex-col gap-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              className="aspect-[16/9] w-full rounded-3xl object-cover"
              fetchPriority="high"
            />
          ) : null}
          <h1 className="text-2xl font-bold sm:text-3xl">{trip.name}</h1>
          <p className="text-lg font-semibold">
            {t('fromPrice', { price: formatMoney(trip.fromMinor, trip.currency, lang) })}{' '}
            <span className="text-base font-normal text-muted">{t('perPerson')}</span>
          </p>
          {trip.description ? (
            <p className="whitespace-pre-line text-muted">{trip.description}</p>
          ) : null}
          <dl className="grid gap-3 rounded-2xl bg-surface-2 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">{t('duration')}</dt>
              <dd className="font-semibold">{formatDuration(trip.durationMinutes)}</dd>
            </div>
            {trip.meetingPoint ? (
              <div>
                <dt className="text-sm text-muted">{t('meetingPoint')}</dt>
                <dd className="font-semibold">{trip.meetingPoint}</dd>
              </div>
            ) : null}
          </dl>
        </header>

        <PublicBookingForm
          tenantSlug={tenant.data.slug}
          product={trip}
          timezone={tenant.data.timezone}
          lang={lang}
        />
      </article>
    </PublicShell>
  );
}

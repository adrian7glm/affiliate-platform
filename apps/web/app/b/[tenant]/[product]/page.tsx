import type { Metadata } from 'next';
import { Alert } from '@/components/Alert';
import { buttonClasses } from '@/components/Button';
import { OperatorContact } from '@/components/public/CancellationPolicy';
import { PublicMessage, PublicShell } from '@/components/public/PublicShell';
import { formatMoney } from '@/lib/format';
import { formatDuration } from '@/lib/i18n';
import { getServerT } from '@/lib/i18n-server';
import { loadProduct, loadTenant, requestLang, withLang } from '@/lib/public-server';
import { PublicBookingForm } from './PublicBookingForm';

interface Props {
  params: Promise<{ tenant: string; product: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ tenant: slug, product: productSlug }, query] = await Promise.all([params, searchParams]);
  const [tenant, product] = await Promise.all([loadTenant(slug), loadProduct(slug, productSlug)]);
  if (!tenant.ok || !product.ok) {
    const { t } = await getServerT(await requestLang(query.lang));
    return { title: t('public.notFoundTitle'), robots: { index: false } };
  }
  return {
    title: { absolute: `${product.data.name} · ${tenant.data.name}` },
    description: product.data.description?.slice(0, 200) ?? undefined,
  };
}

/** One trip: details and the booking form (date, time, tickets, contact, pay). */
export default async function ProductPage({ params, searchParams }: Props) {
  const [{ tenant: slug, product: productSlug }, query] = await Promise.all([params, searchParams]);
  const lang = await requestLang(query.lang);
  const { t } = await getServerT(lang);
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
        <PublicMessage title={notFound ? t('public.productNotFound') : t('common.errorGeneric')}>
          {tenant.ok ? (
            <a href={withLang(tenantPath, lang)} className={buttonClasses('secondary')}>
              {t('public.productsTitle')}
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
            {t('public.fromPrice', { price: formatMoney(trip.fromMinor, trip.currency, lang) })}{' '}
            <span className="text-base font-normal text-muted">{t('public.perPerson')}</span>
          </p>
          {trip.description ? (
            <p className="whitespace-pre-line text-muted">{trip.description}</p>
          ) : null}
          <dl className="grid gap-3 rounded-2xl bg-surface-2 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">{t('public.duration')}</dt>
              <dd className="font-semibold">{formatDuration(trip.durationMinutes, lang)}</dd>
            </div>
            {trip.meetingPoint ? (
              <div>
                <dt className="text-sm text-muted">{t('public.meetingPoint')}</dt>
                <dd className="font-semibold">{trip.meetingPoint}</dd>
              </div>
            ) : null}
          </dl>
        </header>

        {tenant.data.bookingPaused ? (
          <div className="flex flex-col gap-4">
            <Alert tone="info" title={t('public.bookingPausedTitle')}>
              {t('public.bookingPausedText', { tenant: tenant.data.name })}
            </Alert>
            <OperatorContact
              tenantName={tenant.data.name}
              email={tenant.data.contactEmail}
              phone={tenant.data.contactPhone}
            />
          </div>
        ) : (
          <PublicBookingForm
            tenantSlug={tenant.data.slug}
            tenantName={tenant.data.name}
            cancellationPolicy={tenant.data.cancellationPolicy}
            product={trip}
            timezone={tenant.data.timezone}
          />
        )}
      </article>
    </PublicShell>
  );
}

'use client';

import { Card } from '@/components/Card';
import { useT } from '@/components/I18nProvider';
import { ShareActions } from '@/components/ShareActions';
import { formatDate } from '@/lib/dates';
import { discountText } from '@/lib/discounts';
import { affiliateApi } from '@/lib/endpoints';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { useApi } from '@/lib/useApi';

/**
 * The discount codes the operator gave this affiliate (a hotel's -10% for its guests): guests
 * who book with one are the affiliate's, wherever they book from.
 */
export function OwnCodes() {
  const { t, tp, lang } = useT();
  const home = useAffiliateHome();
  const codes = useApi('affiliate-discount-codes', (signal) =>
    affiliateApi.discountCodes({ signal }),
  );
  const tenant = home.data?.tenant;
  if (!tenant || !codes.data || codes.data.length === 0) return null;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <section aria-labelledby="codes-title" className="flex flex-col gap-3">
      <div>
        <h2 id="codes-title" className="text-lg font-semibold">
          {t('affiliate.codes.title')}
        </h2>
        <p className="text-sm text-muted">{t('affiliate.codes.description')}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {codes.data.map((code) => (
          <li key={code.id}>
            <Card>
              <div className="flex flex-col gap-3">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="break-all font-mono text-2xl font-bold">{code.code}</span>
                  <span className="text-lg font-semibold text-success-fg">
                    {discountText(code, tenant.currency, lang)}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  {[
                    code.validUntil
                      ? t('affiliate.codes.until', {
                          day: formatDate(`${code.validUntil}T12:00:00Z`, 'UTC', lang),
                        })
                      : null,
                    tp('affiliate.codes.uses', code.uses),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <ShareActions
                  url={`${origin}/b/${encodeURIComponent(tenant.slug)}?code=${encodeURIComponent(code.code)}`}
                  title={t('affiliate.codes.shareTitle', { name: tenant.name })}
                  text={t('affiliate.codes.shareText', {
                    code: code.code,
                    discount: discountText(code, tenant.currency, lang),
                  })}
                  size="md"
                />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

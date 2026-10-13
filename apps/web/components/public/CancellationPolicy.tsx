'use client';

import { useT } from '../I18nProvider';
import { IconMail, IconPhone } from '../icons';

/**
 * The operator's cancellation policy, shown before paying and on the ticket. Operators who did
 * not write their own get the platform's text, which only promises what the platform does: a
 * full automatic refund when the operator calls the trip off.
 */
export function CancellationPolicy({
  tenantName,
  policy,
  titleAs: Heading = 'h2',
}: {
  tenantName: string;
  policy: string | null;
  titleAs?: 'h2' | 'h3';
}) {
  const { t } = useT();
  return (
    <section aria-labelledby="policy-title" className="flex flex-col gap-1.5">
      <Heading id="policy-title" className="font-semibold">
        {t('public.policy.title')}
      </Heading>
      <p className="whitespace-pre-line text-muted">
        {policy ?? t('public.policy.default', { tenant: tenantName })}
      </p>
    </section>
  );
}

/** Call and email buttons for the operator, when they gave their contact details. */
export function OperatorContact({
  tenantName,
  email,
  phone,
}: {
  tenantName: string;
  email: string | null;
  phone: string | null;
}) {
  const { t } = useT();
  if (!email && !phone) return null;
  const link =
    'inline-flex min-h-12 items-center gap-2 rounded-xl px-2 font-semibold text-brand-strong hover:bg-brand-soft';
  return (
    <section aria-labelledby="operator-contact-title" className="flex flex-col gap-1">
      <h2 id="operator-contact-title" className="font-semibold">
        {t('public.contactOperator', { tenant: tenantName })}
      </h2>
      <div className="-mx-2 flex flex-wrap gap-x-3">
        {phone ? (
          <a href={`tel:${phone}`} className={link}>
            <IconPhone size={20} />
            {phone}
          </a>
        ) : null}
        {email ? (
          <a href={`mailto:${email}`} className={`${link} break-all`}>
            <IconMail size={20} />
            {email}
          </a>
        ) : null}
      </div>
    </section>
  );
}

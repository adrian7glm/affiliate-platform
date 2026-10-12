'use client';

import type { ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { IconPlus, IconScan } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { formatPeriod } from '@/lib/dates';
import { errorMessageRo } from '@/lib/useApi';
import { useOperator } from './OperatorContext';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <dt className="font-semibold text-muted">{label}</dt>
      <dd className="mt-1 text-3xl font-extrabold tracking-tight">{value}</dd>
      {hint ? <dd className="mt-1 text-sm text-muted">{hint}</dd> : null}
    </div>
  );
}

export function Dashboard() {
  const { dashboard, tenant } = useOperator();
  const data = dashboard.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Panou"
        description={data ? `Situația pentru ${formatPeriod(data.periodKey)}` : undefined}
        actions={
          <>
            <ButtonLink href="/o/scan" icon={<IconScan />}>
              Scanează bilete
            </ButtonLink>
            <ButtonLink href="/o/affiliates#invite" variant="secondary" icon={<IconPlus />}>
              Invită afiliat
            </ButtonLink>
          </>
        }
      />

      {dashboard.loading && !data ? <LoadingBlock /> : null}
      {dashboard.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={dashboard.reload}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(dashboard.error)}
        </Alert>
      ) : null}

      {data ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Rezervări" value={data.bookings.count} />
            <Stat
              label="Încasări"
              value={
                <MoneyText amountMinor={data.bookings.revenueMinor} currency={tenant.currency} />
              }
            />
            <Stat
              label="Comisioane"
              value={
                <MoneyText amountMinor={data.commissions.totalMinor} currency={tenant.currency} />
              }
            />
            <Stat
              label="Afiliați activi"
              value={data.affiliates.active}
              hint={
                data.affiliates.invited > 0
                  ? `${data.affiliates.invited} invitați care nu au intrat încă`
                  : undefined
              }
            />
          </dl>

          <Card title="Cei mai buni afiliați" description="După vânzările plătite luna aceasta">
            {data.topAffiliates.length === 0 ? (
              <p className="text-muted">Încă nu sunt vânzări prin afiliați luna aceasta.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line text-sm text-muted">
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        Afiliat
                      </th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">
                        Vânzări
                      </th>
                      <th scope="col" className="py-2 text-right font-semibold">
                        Valoare
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topAffiliates.map((a) => (
                      <tr key={a.affiliateId} className="border-b border-line last:border-0">
                        <th scope="row" className="py-3 pr-3 font-semibold">
                          {a.name}
                        </th>
                        <td className="py-3 pr-3 text-right tabular-nums">{a.paidSales}</td>
                        <td className="whitespace-nowrap py-3 text-right">
                          <MoneyText amountMinor={a.salesMinor} currency={tenant.currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Pagina publică de rezervări">
            <p className="text-muted">
              Turiștii fără afiliat rezervă aici. Linkurile afiliaților duc tot aici, cu atribuire.
            </p>
            <a
              href={`/b/${tenant.slug}`}
              className="mt-2 inline-flex min-h-12 items-center font-semibold text-brand underline"
              target="_blank"
              rel="noopener"
            >
              {typeof window !== 'undefined' ? window.location.origin : ''}/b/{tenant.slug}
            </a>
          </Card>
        </>
      ) : null}
    </div>
  );
}

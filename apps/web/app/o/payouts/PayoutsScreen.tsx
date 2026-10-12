'use client';

import type { ClosePeriodResultDto, CommissionReportDto, PayoutDto } from '@ap/contracts';
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { IconCheck, IconDownload } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { isApiError } from '@/lib/api';
import { downloadCsv, minorToCsvAmount, toCsv } from '@/lib/csv';
import { currentPeriod, formatDate, formatPeriod, shiftPeriod } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { currencyDigits } from '@/lib/format';
import { pluralRo } from '@/lib/i18n';
import { PAYOUT_METHOD, PAYOUT_STATUS } from '@/lib/labels';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

export function PayoutsScreen() {
  const { tenant } = useOperator();
  const thisMonth = currentPeriod(tenant.timezone);
  const [period, setPeriod] = useState(() => shiftPeriod(thisMonth, -1));
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeResult, setCloseResult] = useState<ClosePeriodResultDto | null>(null);
  const [paying, setPaying] = useState<PayoutDto | null>(null);

  const report = useApi(`operator-report:${tenant.id}:${period}`, (signal) =>
    operatorApi.commissionReport(period, { signal }),
  );
  const payouts = useApi(`operator-payouts:${tenant.id}:${period}`, (signal) =>
    operatorApi.payouts(period, { signal }),
  );

  const monthOver = period < thisMonth;
  const unpaid = (payouts.data ?? []).filter((p) => p.status !== 'paid');

  function changePeriod(next: string) {
    setCloseResult(null);
    setPeriod(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Comisioane și plăți"
        description="Comisioanele afiliaților pe lună. La sfârșitul lunii închizi perioada: comisioanele pentru excursiile făcute se aprobă și se calculează suma de plată pentru fiecare afiliat."
      />

      <div className="max-w-md">
        <PeriodPicker period={period} onChange={changePeriod} maxPeriod={thisMonth} />
      </div>

      <ReportCard
        report={report.data}
        loading={report.loading}
        error={report.error}
        onRetry={report.reload}
        period={period}
      />

      <Card
        title={`Plăți pentru ${formatPeriod(period)}`}
        description={
          monthOver
            ? 'Închiderea se poate repeta: dacă au apărut anulări sau vânzări noi, sumele se recalculează.'
            : 'Perioada se poate închide după ce se termină luna.'
        }
        action={
          monthOver ? <Button onClick={() => setConfirmClose(true)}>Închide perioada</Button> : null
        }
      >
        {closeResult ? (
          <Alert tone="success" title="Perioada a fost închisă" className="mb-3">
            {pluralRo(closeResult.entriesApproved, 'comision aprobat', 'comisioane aprobate')},{' '}
            {pluralRo(closeResult.adjustmentsCreated, 'ajustare', 'ajustări')},{' '}
            {pluralRo(closeResult.payouts.length, 'plată de făcut', 'plăți de făcut')}.
          </Alert>
        ) : null}
        {payouts.loading && !payouts.data ? <LoadingBlock /> : null}
        {payouts.error ? (
          <Alert
            tone="error"
            action={
              <Button variant="secondary" onClick={payouts.reload}>
                Încearcă din nou
              </Button>
            }
          >
            {errorMessageRo(payouts.error)}
          </Alert>
        ) : null}
        {payouts.data && payouts.data.length === 0 ? (
          <p className="text-muted">
            {monthOver
              ? 'Nicio plată încă. Închide perioada ca să le calculezi.'
              : 'Nicio plată pentru această lună.'}
          </p>
        ) : null}
        {payouts.data && payouts.data.length > 0 ? (
          <>
            <ul className="divide-y divide-line">
              {payouts.data.map((payout) => (
                <li
                  key={payout.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{payout.affiliateName}</p>
                    <p className="text-sm text-muted">
                      {PAYOUT_METHOD[payout.method]}
                      {payout.paidAt
                        ? ` · plătit pe ${formatDate(payout.paidAt, tenant.timezone)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <MoneyText
                      amountMinor={payout.amountMinor}
                      currency={payout.currency}
                      className="text-lg font-semibold"
                    />
                    <StatusChip tone={PAYOUT_STATUS[payout.status].tone}>
                      {PAYOUT_STATUS[payout.status].label}
                    </StatusChip>
                    {payout.status !== 'paid' ? (
                      <Button
                        variant="secondary"
                        icon={<IconCheck />}
                        onClick={() => setPaying(payout)}
                      >
                        Marchează plătit
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <p className="text-muted">
                De plătit:{' '}
                <MoneyText
                  amountMinor={unpaid.reduce((sum, p) => sum + p.amountMinor, 0)}
                  currency={tenant.currency}
                  className="font-semibold text-fg"
                />
              </p>
              <Button
                variant="ghost"
                icon={<IconDownload />}
                onClick={() => exportPayouts(payouts.data ?? [], period, tenant.timezone)}
              >
                Descarcă CSV
              </Button>
            </div>
          </>
        ) : null}
      </Card>

      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title={`Închizi ${formatPeriod(period)}?`}
        description="Comisioanele pentru excursiile care au avut loc se aprobă, iar pentru fiecare afiliat se calculează o plată. Banii nu se trimit automat: după ce plătești, apasă „Marchează plătit”."
      >
        <ClosePeriodForm
          period={period}
          onCancel={() => setConfirmClose(false)}
          onDone={(result) => {
            setCloseResult(result);
            setConfirmClose(false);
            payouts.setData(result.payouts);
            report.reload();
          }}
        />
      </Dialog>

      <Dialog open={paying !== null} onClose={() => setPaying(null)} title="Ai plătit afiliatul?">
        {paying ? (
          <MarkPaidForm
            key={paying.id}
            payout={paying}
            onCancel={() => setPaying(null)}
            onDone={(updated) => {
              payouts.setData((prev) =>
                (prev ?? []).map((p) => (p.id === updated.id ? updated : p)),
              );
              setPaying(null);
              report.reload();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function exportPayouts(list: PayoutDto[], period: string, timezone: string) {
  const csv = toCsv(
    ['Afiliat', 'Perioada', 'Suma', 'Moneda', 'Status', 'Metoda', 'Plătit la'],
    list.map((p) => [
      p.affiliateName,
      p.periodKey,
      minorToCsvAmount(p.amountMinor, currencyDigits(p.currency)),
      p.currency,
      PAYOUT_STATUS[p.status].label,
      PAYOUT_METHOD[p.method],
      p.paidAt ? formatDate(p.paidAt, timezone) : '',
    ]),
  );
  downloadCsv(`plati-afiliati-${period}.csv`, csv);
}

function exportReport(report: CommissionReportDto) {
  const digits = currencyDigits(report.currency);
  const money = (minor: number) => minorToCsvAmount(minor, digits);
  const csv = toCsv(
    [
      'Afiliat',
      'Vânzări plătite',
      'Valoare vânzări',
      'În așteptare',
      'Aprobat',
      'Plătit',
      'Total comision',
      'Moneda',
    ],
    [
      ...report.rows.map((r) => [
        r.affiliateName,
        r.paidSales,
        money(r.salesMinor),
        money(r.pendingMinor),
        money(r.approvedMinor),
        money(r.paidMinor),
        money(r.totalMinor),
        report.currency,
      ]),
      [
        'Total',
        report.totals.paidSales,
        money(report.totals.salesMinor),
        money(report.totals.pendingMinor),
        money(report.totals.approvedMinor),
        money(report.totals.paidMinor),
        money(report.totals.totalMinor),
        report.currency,
      ],
    ],
  );
  downloadCsv(`comisioane-${report.periodKey}.csv`, csv);
}

const REPORT_COLUMNS = [
  { key: 'salesMinor', label: 'Valoare vânzări' },
  { key: 'pendingMinor', label: 'În așteptare' },
  { key: 'approvedMinor', label: 'Aprobat' },
  { key: 'paidMinor', label: 'Plătit' },
  { key: 'totalMinor', label: 'Total comision' },
] as const;

function ReportCard({
  report,
  loading,
  error,
  onRetry,
  period,
}: {
  report: CommissionReportDto | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  period: string;
}) {
  return (
    <Card
      title="Raport comisioane"
      description={`Vânzări plătite în ${formatPeriod(period)} și comisioanele lor.`}
      action={
        report && report.rows.length > 0 ? (
          <Button variant="ghost" icon={<IconDownload />} onClick={() => exportReport(report)}>
            Descarcă CSV
          </Button>
        ) : null
      }
    >
      {loading && !report ? <LoadingBlock /> : null}
      {error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={onRetry}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(error)}
        </Alert>
      ) : null}
      {report && report.rows.length === 0 ? (
        <p className="text-muted">Nicio vânzare prin afiliați în această lună.</p>
      ) : null}
      {report && report.rows.length > 0 ? (
        <>
          {/* Phones: one card per affiliate. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {report.rows.map((row) => (
              <li key={row.affiliateId} className="rounded-2xl bg-surface-2 p-3">
                <p className="font-semibold">{row.affiliateName}</p>
                <p className="text-sm text-muted">
                  {pluralRo(row.paidSales, 'vânzare plătită', 'vânzări plătite')}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {REPORT_COLUMNS.map((col) => (
                    <div key={col.key} className="contents">
                      <dt className="text-muted">{col.label}</dt>
                      <dd className="text-right font-semibold tabular-nums">
                        <MoneyText amountMinor={row[col.key]} currency={report.currency} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
            <li className="rounded-2xl border-2 border-line p-3">
              <p className="font-semibold">Total</p>
              <p className="text-lg font-bold">
                <MoneyText amountMinor={report.totals.totalMinor} currency={report.currency} />{' '}
                comision
              </p>
            </li>
          </ul>

          {/* Larger screens: a table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left">
              <caption className="visually-hidden">
                Comisioane pe afiliat, {formatPeriod(period)}
              </caption>
              <thead className="text-sm text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Afiliat
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Vânzări
                  </th>
                  {REPORT_COLUMNS.map((col) => (
                    <th key={col.key} scope="col" className="px-3 py-2 text-right font-semibold">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.affiliateId} className="border-b border-line">
                    <th scope="row" className="py-2.5 pr-3 font-semibold">
                      {row.affiliateName}
                    </th>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.paidSales}</td>
                    {REPORT_COLUMNS.map((col) => (
                      <td key={col.key} className="px-3 py-2.5 text-right tabular-nums">
                        <MoneyText amountMinor={row[col.key]} currency={report.currency} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <th scope="row" className="py-2.5 pr-3">
                    Total
                  </th>
                  <td className="px-3 py-2.5 text-right tabular-nums">{report.totals.paidSales}</td>
                  {REPORT_COLUMNS.map((col) => (
                    <td key={col.key} className="px-3 py-2.5 text-right tabular-nums">
                      <MoneyText amountMinor={report.totals[col.key]} currency={report.currency} />
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : null}
    </Card>
  );
}

function ClosePeriodForm({
  period,
  onCancel,
  onDone,
}: {
  period: string;
  onCancel: () => void;
  onDone: (result: ClosePeriodResultDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    setBusy(true);
    setError(null);
    try {
      onDone(await operatorApi.closePeriod({ periodKey: period }));
    } catch (err) {
      setError(
        isApiError(err) && err.status === 409
          ? 'Luna nu s-a încheiat încă. O poți închide de pe 1 a lunii următoare.'
          : errorMessageRo(err),
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Renunță
        </Button>
        <Button onClick={close} loading={busy} loadingText="Se închide…">
          Închide perioada
        </Button>
      </div>
    </div>
  );
}

function MarkPaidForm({
  payout,
  onCancel,
  onDone,
}: {
  payout: PayoutDto;
  onCancel: () => void;
  onDone: (payout: PayoutDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onDone(await operatorApi.markPayoutPaid(payout.id));
    } catch (err) {
      setError(errorMessageRo(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        Confirmă că i-ai plătit lui <strong>{payout.affiliateName}</strong>{' '}
        <MoneyText
          amountMinor={payout.amountMinor}
          currency={payout.currency}
          className="font-semibold"
        />{' '}
        pentru {formatPeriod(payout.periodKey)}. Afiliatul va vedea comisioanele ca plătite.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Renunță
        </Button>
        <Button
          variant="success"
          icon={<IconCheck />}
          onClick={confirm}
          loading={busy}
          loadingText="Se salvează…"
        >
          Da, am plătit
        </Button>
      </div>
    </div>
  );
}

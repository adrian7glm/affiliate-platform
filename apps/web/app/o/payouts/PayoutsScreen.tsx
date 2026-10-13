'use client';

import type { ClosePeriodResultDto, CommissionReportDto, PayoutDto } from '@ap/contracts';
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { useT } from '@/components/I18nProvider';
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
import { currencyDigits, formatMoney } from '@/lib/format';
import type { Translator } from '@/lib/i18n';
import { payoutMethod, payoutStatus } from '@/lib/labels';
import { errorMessage, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';
import { Rich, slots } from '@/components/Rich';

export function PayoutsScreen() {
  const tr = useT();
  const { t, tp, lang } = tr;
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
        title={t('operator.payouts.title')}
        description={t('operator.payouts.description')}
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
        title={t('operator.payouts.payoutsTitle', { period: formatPeriod(period, lang) })}
        description={
          monthOver ? t('operator.payouts.closeAgain') : t('operator.payouts.closeLater')
        }
        action={
          monthOver ? (
            <Button onClick={() => setConfirmClose(true)}>{t('operator.payouts.close')}</Button>
          ) : null
        }
      >
        {closeResult ? (
          <Alert tone="success" title={t('operator.payouts.closedTitle')} className="mb-3">
            {t('operator.payouts.closedSummary', {
              approved: tp('operator.payouts.approvedCount', closeResult.entriesApproved),
              adjustments: tp('operator.payouts.adjustmentsCount', closeResult.adjustmentsCreated),
              payouts: tp('operator.payouts.payoutsCount', closeResult.payouts.length),
            })}
          </Alert>
        ) : null}
        {payouts.loading && !payouts.data ? <LoadingBlock /> : null}
        {payouts.error ? (
          <Alert
            tone="error"
            action={
              <Button variant="secondary" onClick={payouts.reload}>
                {t('common.retry')}
              </Button>
            }
          >
            {errorMessage(payouts.error, tr)}
          </Alert>
        ) : null}
        {payouts.data && payouts.data.length === 0 ? (
          <p className="text-muted">
            {monthOver ? t('operator.payouts.emptyClosable') : t('operator.payouts.emptyOpen')}
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
                      {payoutMethod(tr, payout.method)}
                      {payout.paidAt
                        ? ` · ${t('operator.payouts.paidOn', {
                            date: formatDate(payout.paidAt, tenant.timezone, lang),
                          })}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <MoneyText
                      amountMinor={payout.amountMinor}
                      currency={payout.currency}
                      className="text-lg font-semibold"
                    />
                    <StatusChip tone={payoutStatus(tr, payout.status).tone}>
                      {payoutStatus(tr, payout.status).label}
                    </StatusChip>
                    {payout.status !== 'paid' ? (
                      <Button
                        variant="secondary"
                        icon={<IconCheck />}
                        onClick={() => setPaying(payout)}
                      >
                        {t('operator.payouts.markPaid')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <p className="text-muted">
                {t('operator.payouts.toPay')}{' '}
                <MoneyText
                  amountMinor={unpaid.reduce((sum, p) => sum + p.amountMinor, 0)}
                  currency={tenant.currency}
                  className="font-semibold text-fg"
                />
              </p>
              <Button
                variant="ghost"
                icon={<IconDownload />}
                onClick={() => exportPayouts(payouts.data ?? [], period, tenant.timezone, tr)}
              >
                {t('operator.payouts.downloadCsv')}
              </Button>
            </div>
          </>
        ) : null}
      </Card>

      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title={t('operator.payouts.confirmCloseTitle', { period: formatPeriod(period, lang) })}
        description={t('operator.payouts.confirmCloseDescription')}
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

      <Dialog
        open={paying !== null}
        onClose={() => setPaying(null)}
        title={t('operator.payouts.paidTitle')}
      >
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

function exportPayouts(list: PayoutDto[], period: string, timezone: string, tr: Translator) {
  const { t, lang } = tr;
  const csv = toCsv(
    [
      t('operator.payouts.csvAffiliate'),
      t('operator.payouts.csvPeriod'),
      t('operator.payouts.csvAmount'),
      t('operator.payouts.csvCurrency'),
      t('operator.payouts.csvStatus'),
      t('operator.payouts.csvMethod'),
      t('operator.payouts.csvPaidAt'),
    ],
    list.map((p) => [
      p.affiliateName,
      p.periodKey,
      minorToCsvAmount(p.amountMinor, currencyDigits(p.currency)),
      p.currency,
      payoutStatus(tr, p.status).label,
      payoutMethod(tr, p.method),
      p.paidAt ? formatDate(p.paidAt, timezone, lang) : '',
    ]),
  );
  downloadCsv(t('operator.payouts.csvPayoutsFile', { period }), csv);
}

function exportReport(report: CommissionReportDto, tr: Translator) {
  const { t } = tr;
  const digits = currencyDigits(report.currency);
  const money = (minor: number) => minorToCsvAmount(minor, digits);
  const csv = toCsv(
    [
      t('operator.payouts.csvAffiliate'),
      t('operator.payouts.csvPaidSales'),
      ...REPORT_COLUMNS.map((col) => t(col.label)),
      t('operator.payouts.csvCurrency'),
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
        t('common.total'),
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
  downloadCsv(t('operator.payouts.csvReportFile', { period: report.periodKey }), csv);
}

const REPORT_COLUMNS = [
  { key: 'salesMinor', label: 'operator.payouts.colSales' },
  { key: 'pendingMinor', label: 'operator.payouts.colPending' },
  { key: 'approvedMinor', label: 'operator.payouts.colApproved' },
  { key: 'paidMinor', label: 'operator.payouts.colPaid' },
  { key: 'totalMinor', label: 'operator.payouts.colTotal' },
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
  const tr = useT();
  const { t, tp, lang } = tr;
  return (
    <Card
      title={t('operator.payouts.reportTitle')}
      description={t('operator.payouts.reportDescription', {
        period: formatPeriod(period, lang),
      })}
      action={
        report && report.rows.length > 0 ? (
          <Button variant="ghost" icon={<IconDownload />} onClick={() => exportReport(report, tr)}>
            {t('operator.payouts.downloadCsv')}
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
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(error, tr)}
        </Alert>
      ) : null}
      {report && report.rows.length === 0 ? (
        <p className="text-muted">{t('operator.payouts.noSales')}</p>
      ) : null}
      {report && report.rows.length > 0 ? (
        <>
          {/* Phones: one card per affiliate. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {report.rows.map((row) => (
              <li key={row.affiliateId} className="rounded-2xl bg-surface-2 p-3">
                <p className="font-semibold">{row.affiliateName}</p>
                <p className="text-sm text-muted">
                  {tp('operator.payouts.paidSales', row.paidSales)}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {REPORT_COLUMNS.map((col) => (
                    <div key={col.key} className="contents">
                      <dt className="text-muted">{t(col.label)}</dt>
                      <dd className="text-right font-semibold tabular-nums">
                        <MoneyText amountMinor={row[col.key]} currency={report.currency} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
            <li className="rounded-2xl border-2 border-line p-3">
              <p className="font-semibold">{t('common.total')}</p>
              <p className="text-lg font-bold">
                {t('operator.payouts.totalCommission', {
                  amount: formatMoney(report.totals.totalMinor, report.currency, lang),
                })}
              </p>
            </li>
          </ul>

          {/* Larger screens: a table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left">
              <caption className="visually-hidden">
                {t('operator.payouts.tableCaption', { period: formatPeriod(period, lang) })}
              </caption>
              <thead className="text-sm text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    {t('operator.payouts.affiliate')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t('operator.payouts.sales')}
                  </th>
                  {REPORT_COLUMNS.map((col) => (
                    <th key={col.key} scope="col" className="px-3 py-2 text-right font-semibold">
                      {t(col.label)}
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
                    {t('common.total')}
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
  const tr = useT();
  const { t } = tr;
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
          ? t('operator.payouts.notOver')
          : errorMessage(err, tr),
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button onClick={close} loading={busy} loadingText={t('operator.payouts.closing')}>
          {t('operator.payouts.close')}
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
  const tr = useT();
  const { t, lang } = tr;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onDone(await operatorApi.markPayoutPaid(payout.id));
    } catch (err) {
      setError(errorMessage(err, tr));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        <Rich
          text={t('operator.payouts.markPaidText', {
            ...slots('name', 'amount'),
            period: formatPeriod(payout.periodKey, lang),
          })}
          parts={{
            name: <strong>{payout.affiliateName}</strong>,
            amount: (
              <MoneyText
                amountMinor={payout.amountMinor}
                currency={payout.currency}
                className="font-semibold"
              />
            ),
          }}
        />
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="success"
          icon={<IconCheck />}
          onClick={confirm}
          loading={busy}
          loadingText={t('common.saving')}
        >
          {t('operator.payouts.yesPaid')}
        </Button>
      </div>
    </div>
  );
}

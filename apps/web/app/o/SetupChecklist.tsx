'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import { IconCheck, IconChevronRight } from '@/components/icons';
import { useSession } from '@/components/AuthGate';
import { useT } from '@/components/I18nProvider';
import { operatorPlatformApi } from '@/lib/platform-endpoints';
import { daysUntil, onboardingStep } from '@/lib/platform-labels';
import { useApi } from '@/lib/useApi';
import { useOperator } from './OperatorContext';

/**
 * Guided setup on the operator home: the steps to a first booking, and the trial reminder.
 * Disappears once every step is done.
 */
export function SetupChecklist() {
  const tr = useT();
  const { t, tp } = tr;
  const { tenant } = useOperator();
  const { membership } = useSession();
  const [welcome, setWelcome] = useState(false);
  const setup = useApi(`operator-onboarding:${tenant.id}`, (signal) =>
    operatorPlatformApi.onboarding({ signal }),
  );
  const billing = useApi(`operator-billing:${tenant.id}`, (signal) =>
    operatorPlatformApi.billing({ signal }),
  );

  useEffect(() => {
    setWelcome(new URLSearchParams(window.location.search).get('welcome') === '1');
  }, []);

  const sub = billing.data?.subscription;
  const steps = setup.data?.steps ?? [];
  const next = steps.find((s) => !s.done);
  const done = setup.data ? setup.data.completed === setup.data.total : true;

  return (
    <div className="flex flex-col gap-4 pt-4 empty:hidden">
      {welcome ? (
        <Alert tone="success" title={t('operator.setup.welcomeTitle', { name: tenant.name })}>
          {t('operator.setup.welcomeText')}
        </Alert>
      ) : null}

      {sub?.status === 'past_due' && membership.role === 'owner' ? (
        <Alert
          tone="warning"
          title={
            sub.currentPeriodEnd
              ? t('operator.setup.unpaidTitle')
              : t('operator.setup.trialEndedTitle')
          }
          action={
            <ButtonLink href="/o/billing" variant="secondary">
              {t('operator.setup.seeSubscription')}
            </ButtonLink>
          }
        >
          {t('operator.setup.pastDueText')}
        </Alert>
      ) : null}

      {!done && setup.data ? (
        <section
          aria-labelledby="setup-title"
          className="rounded-3xl border border-line bg-surface p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="setup-title" className="text-lg font-semibold">
              {tp('operator.setup.title', setup.data.total)}
            </h2>
            <p className="text-sm text-muted">
              {t('operator.setup.progress', {
                done: setup.data.completed,
                total: setup.data.total,
              })}
              {sub?.status === 'trialing' && sub.trialEndsAt
                ? ` · ${tp('operator.setup.trialDaysLeft', daysUntil(sub.trialEndsAt))}`
                : ''}
            </p>
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-label={t('operator.setup.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={setup.data.total}
            aria-valuenow={setup.data.completed}
          >
            <div
              className="h-full rounded-full bg-success"
              style={{ width: `${(setup.data.completed / setup.data.total) * 100}%` }}
            />
          </div>
          <ol className="mt-4 flex flex-col gap-1">
            {steps.map((step) => {
              const info = onboardingStep(tr, step.key);
              const isNext = step.key === next?.key;
              return (
                <li key={step.key}>
                  <Link
                    href={info.href}
                    className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 ${
                      isNext ? 'bg-brand-soft text-brand-soft-fg' : 'hover:bg-surface-2'
                    }`}
                  >
                    {step.done ? (
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-on-success">
                        <IconCheck size={16} />
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className={`inline-block size-7 shrink-0 rounded-full border-2 ${
                          isNext ? 'border-brand' : 'border-line-strong'
                        }`}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block font-semibold ${step.done ? 'text-muted line-through' : ''}`}
                      >
                        {info.label}
                        <span className="visually-hidden">
                          {step.done ? ` ${t('operator.setup.stepDone')}` : ''}
                        </span>
                      </span>
                      {isNext ? (
                        <>
                          <span className="block text-sm">{info.description}</span>
                          <span className="mt-1 block text-sm font-semibold underline">
                            {info.cta}
                          </span>
                        </>
                      ) : null}
                    </span>
                    {!step.done ? <IconChevronRight size={18} className="shrink-0" /> : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

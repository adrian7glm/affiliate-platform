import type { ReactNode } from 'react';
import { IconAlert, IconCheck, IconInfo } from './icons';

type AlertTone = 'error' | 'info' | 'success' | 'warning';

const STYLES: Record<AlertTone, string> = {
  error: 'bg-danger-soft text-danger-fg border-danger/40',
  warning: 'bg-warning-soft text-warning-fg border-warning/40',
  info: 'bg-brand-soft text-brand-soft-fg border-brand/30',
  success: 'bg-success-soft text-success-fg border-success/40',
};

/**
 * Inline message. Errors use role="alert" (announced immediately); the others role="status".
 */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className = '',
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = tone === 'success' ? IconCheck : tone === 'info' ? IconInfo : IconAlert;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-2xl border p-3.5 ${STYLES[tone]} ${className}`}
    >
      <Icon className="mt-0.5 shrink-0" size={22} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-0.5' : ''}>{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'md' | 'lg' | 'xl';

const BASE =
  // A transparent border becomes visible in forced-colors mode, so the button keeps its shape.
  'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-transparent font-semibold text-center select-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:opacity-60';

const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-12 px-4 py-2 text-base',
  lg: 'min-h-14 px-5 py-3 text-lg',
  xl: 'min-h-20 px-6 py-4 text-xl',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong',
  secondary: 'bg-surface text-fg border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-brand hover:bg-brand-soft',
  danger: 'bg-danger text-on-danger hover:opacity-90',
  success: 'bg-success text-on-success hover:opacity-90',
};

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  block = false,
  extra = '',
): string {
  return [BASE, SIZES[size], VARIANTS[variant], block ? 'w-full' : '', extra]
    .filter(Boolean)
    .join(' ');
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, CommonProps {
  /** Shows a spinner and blocks repeated clicks (e.g. while a form is submitting). */
  loading?: boolean;
  loadingText?: string;
}

export function Button({
  variant,
  size,
  block,
  icon,
  loading = false,
  loadingText,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={20} /> : icon}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement>, CommonProps {
  href: string;
  /** Render a plain <a> (external URLs, wa.me, sms:, downloads) instead of a Next.js Link. */
  external?: boolean;
}

export function ButtonLink({
  variant,
  size,
  block,
  icon,
  className,
  children,
  href,
  external = false,
  ...rest
}: ButtonLinkProps) {
  const classes = buttonClasses(variant, size, block, className);
  if (external) {
    return (
      <a href={href} className={classes} {...rest}>
        {icon}
        <span>{children}</span>
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}

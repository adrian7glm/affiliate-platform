import { useId, type ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  /** Heading level of the title (default h2). */
  titleAs?: 'h2' | 'h3';
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Surface for a group of related content. With a title it becomes a labelled <section>. */
export function Card({
  title,
  titleAs = 'h2',
  description,
  action,
  className = '',
  children,
}: CardProps) {
  const id = useId();
  const Heading = titleAs;
  const classes = `rounded-3xl border border-line bg-surface p-4 sm:p-5 ${className}`;
  if (!title) return <div className={classes}>{children}</div>;
  return (
    <section className={classes} aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading id={id} className="text-lg font-semibold">
            {title}
          </Heading>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

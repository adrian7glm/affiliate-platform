export function Spinner({ size = 24, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role={label ? 'status' : undefined}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className="animate-spin"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="3"
        />
        <path
          d="M21.5 12A9.5 9.5 0 0 0 12 2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span>{label}</span> : null}
    </span>
  );
}

/** Centered loading placeholder for a whole section. */
export function LoadingBlock({ label = 'Se încarcă…' }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center text-muted">
      <Spinner label={label} />
    </div>
  );
}

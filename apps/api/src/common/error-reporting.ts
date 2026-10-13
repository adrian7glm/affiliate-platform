import * as Sentry from '@sentry/node';

let enabled = false;

/**
 * Sends unexpected errors (API 500s, failed background jobs, internal events that stopped being
 * retried) to Sentry when SENTRY_DSN is set. Without it, errors are only logged.
 */
export function initErrorReporting(options: {
  dsn: string | undefined;
  environment: string;
  role: 'api' | 'worker';
}): void {
  if (!options.dsn) return;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    serverName: options.role,
    // Errors only: no performance tracing, and no request bodies (they hold customers' data).
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  enabled = true;
}

export function reportError(error: unknown, context: Record<string, string | number> = {}): void {
  if (!enabled) return;
  Sentry.captureException(error, { tags: context });
}

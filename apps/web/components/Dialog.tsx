'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from './I18nProvider';
import { IconX } from './icons';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Close button label (default: common.close). */
  closeLabel?: string;
  /** Allow closing by tapping the backdrop (default true). */
  lightDismiss?: boolean;
}

/**
 * Modal built on the native <dialog> opened with showModal(): the browser makes the rest of the
 * page inert, handles Esc / back gestures, and keeps focus inside. On phones it docks to the
 * bottom like a sheet.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  closeLabel,
  lightDismiss = true,
}: DialogProps) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => onCloseRef.current();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  // `closedby="any"` gives native light dismiss where supported; the click handler below is the
  // fallback for browsers without it.
  const extraAttributes = lightDismiss ? ({ closedby: 'any' } as Record<string, string>) : {};

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="m-0 mt-auto w-full max-w-none rounded-t-3xl p-0 shadow-2xl sm:m-auto sm:max-w-lg sm:rounded-3xl"
      style={{ maxHeight: 'min(92dvh, 52rem)' }}
      onClick={(event) => {
        if (lightDismiss && event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          const inside =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;
          if (!inside) ref.current.close();
        }
      }}
      {...extraAttributes}
    >
      {open ? (
        <div
          className="flex flex-col gap-4 p-5"
          style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-xl font-bold">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="-mr-2 -mt-1 inline-flex size-12 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
              aria-label={closeLabel ?? t('common.close')}
            >
              <IconX />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

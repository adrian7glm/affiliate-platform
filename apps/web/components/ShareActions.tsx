'use client';

import { useEffect, useState } from 'react';
import { canShare, copyText, shareLink } from '@/lib/share';
import { Button, type ButtonSize } from './Button';
import { useT } from './I18nProvider';
import { IconCheck, IconCopy, IconShare } from './icons';

interface ShareActionsProps {
  url: string;
  title?: string;
  text?: string;
  copyLabel?: string;
  copiedLabel?: string;
  shareLabel?: string;
  size?: ButtonSize;
  /** Stack buttons full width (phones) instead of a row. */
  stacked?: boolean;
}

/** "Copy link" with visible + announced feedback, and the native share sheet when available. */
export function ShareActions({
  url,
  title,
  text,
  copyLabel,
  copiedLabel,
  shareLabel,
  size = 'lg',
  stacked = true,
}: ShareActionsProps) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);

  useEffect(() => setShareSupported(canShare()), []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className={stacked ? 'grid gap-2 sm:grid-cols-2' : 'flex flex-wrap gap-2'}>
      <Button
        variant="secondary"
        size={size}
        block={stacked}
        icon={copied ? <IconCheck /> : <IconCopy />}
        onClick={async () => setCopied(await copyText(url))}
      >
        {copied ? t('common.copied') : (copyLabel ?? t('common.copyLink'))}
      </Button>
      {shareSupported ? (
        <Button
          variant="secondary"
          size={size}
          block={stacked}
          icon={<IconShare />}
          onClick={() => void shareLink({ title, text, url })}
        >
          {shareLabel ?? t('common.share')}
        </Button>
      ) : null}
      <span className="visually-hidden" role="status" aria-live="polite">
        {copied ? (copiedLabel ?? t('common.linkCopied')) : ''}
      </span>
    </div>
  );
}

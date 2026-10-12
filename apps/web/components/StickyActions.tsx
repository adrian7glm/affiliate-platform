import type { ReactNode } from 'react';

/**
 * Bottom action bar that stays reachable by the thumb while scrolling a long step.
 * `aboveNav` lifts it above the affiliate tab bar.
 */
export function StickyActions({
  children,
  aboveNav = false,
}: {
  children: ReactNode;
  aboveNav?: boolean;
}) {
  return (
    <div
      className="no-print sticky z-30 mt-2 border-t border-line bg-bg/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-bg/80"
      style={{
        bottom: aboveNav ? 'calc(var(--nav-h) + var(--safe-bottom))' : '0px',
        paddingBottom: aboveNav ? undefined : 'max(0.75rem, var(--safe-bottom))',
      }}
    >
      {children}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface BottomNavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Active when the path equals `href` (exact) or starts with it (default). */
  exact?: boolean;
}

export function isActivePath(
  pathname: string,
  item: Pick<BottomNavItem, 'href' | 'exact'>,
): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Fixed tab bar for the phone app, sized for thumbs and respecting the home indicator. */
export function BottomNav({
  items,
  label = 'Navigare principală',
}: {
  items: BottomNavItem[];
  label?: string;
}) {
  const pathname = usePathname() ?? '';
  return (
    <nav
      aria-label={label}
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul
        className="mx-auto grid max-w-xl"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = isActivePath(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[var(--nav-h)] flex-col items-center justify-center gap-0.5 px-1 text-xs font-semibold ${
                  active ? 'text-brand' : 'text-muted hover:text-fg'
                }`}
              >
                <span
                  className={`inline-flex h-8 w-14 items-center justify-center rounded-full ${active ? 'bg-brand-soft' : ''}`}
                >
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

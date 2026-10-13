import type { DemoAccountRole } from '@ap/contracts';

/** Password of every demo account. Only listed on the sign-in page while DEMO_MODE is on. */
export const DEMO_PASSWORD = 'demo1234';

/** The demo seed creates these; the sign-in page lists them in this order. */
export const DEMO_ACCOUNTS: { role: DemoAccountRole; name: string; email: string }[] = [
  { role: 'admin', name: 'Admin platformă', email: 'admin@demo.test' },
  { role: 'owner', name: 'Operator Demo', email: 'owner@demo.test' },
  { role: 'affiliate', name: 'Ana', email: 'ana@demo.test' },
  { role: 'scanner', name: 'Ion', email: 'scanner@demo.test' },
];

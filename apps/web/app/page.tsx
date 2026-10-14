import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { ButtonLink } from '@/components/Button';
import { PublicI18n } from '@/components/public/PublicI18n';
import { SiteFooter, SiteHeader } from '@/components/public/SiteChrome';
import { Rich, slots } from '@/components/Rich';
import type { Translator } from '@/lib/i18n';
import { getServerT, serverLang, serverLanguages, serverOverrides } from '@/lib/i18n-server';
import styles from './landing.module.css';

type T = Translator['t'];

interface Props {
  searchParams: Promise<{ lang?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { t } = await getServerT(await serverLang((await searchParams).lang));
  return { title: { absolute: t('common.appFullName') }, description: t('common.appDescription') };
}

/**
 * Presentation page for business owners. Light only (the page pins the light tokens, header and
 * footer included). Switching the language reloads it with `?lang=`.
 */
export default async function LandingPage({ searchParams }: Props) {
  const lang = await serverLang((await searchParams).lang);
  const [{ t }, languages, overrides] = await Promise.all([
    getServerT(lang),
    serverLanguages(),
    serverOverrides(lang),
  ]);
  return (
    <Suspense>
      <PublicI18n lang={lang} languages={languages} overrides={overrides}>
        <div className={styles.page}>
          <SiteHeader />
          <LandingContent t={t} />
          <SiteFooter />
        </div>
      </PublicI18n>
    </Suspense>
  );
}

function LandingContent({ t }: { t: T }) {
  return (
    <main id="content" className={`${styles.main} page-x`}>
      <div className={styles.wrap}>
        <Hero t={t} />
        <HowItWorks t={t} />
        <Wins t={t} />
        <Included t={t} />
        <Closing t={t} />
        <p className={styles.footnote}>{t('public.landing.footnote')}</p>
      </div>
    </main>
  );
}

function Ctas({ t }: { t: T }) {
  return (
    <div className={styles.ctas}>
      <ButtonLink href="/start" size="lg">
        {t('public.landing.startFree')}
      </ButtonLink>
      <ButtonLink href="/contact?topic=demo" size="lg" variant="secondary">
        {t('public.landing.requestDemo')}
      </ButtonLink>
    </div>
  );
}

/* ---------- hero ---------- */

function Hero({ t }: { t: T }) {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div>
        <p className={styles.eyebrow}>{t('public.landing.hero.eyebrow')}</p>
        <h1 id="hero-title">
          <Rich
            text={t('public.landing.hero.title', slots('emphasis'))}
            parts={{ emphasis: <em>{t('public.landing.hero.titleEmphasis')}</em> }}
          />
        </h1>
        <p className={styles.lede}>{t('public.landing.hero.lede')}</p>
        <ul className={styles.pills}>
          {(['customers', 'realSales', 'anyPhone'] as const).map((key) => (
            <li key={key} className={styles.pill}>
              <i aria-hidden="true" />
              {t(`public.landing.hero.pills.${key}`)}
            </li>
          ))}
        </ul>
        <Ctas t={t} />
      </div>
      <div className={styles.map}>
        <NetworkMap t={t} />
      </div>
    </section>
  );
}

/**
 * Estimated font size so a label fits `avail` SVG units: the text is server-rendered, so it
 * cannot be measured; long translations shrink instead of spilling out of their pill.
 */
function fit(text: string, base: number, avail: number, widthFactor: number, min = 11): number {
  const cyrillic = /[Ѐ-ӿ]/.test(text) ? 1.08 : 1;
  const estimate = [...text].length * base * widthFactor * cyrillic;
  return estimate <= avail ? base : Math.max(min, Math.floor((base * avail * 10) / estimate) / 10);
}

const NODES = [
  { key: 'hotel', x: 20, y: 46, w: 196 },
  { key: 'guide', x: 384, y: 46, w: 196 },
  { key: 'beachBar', x: 4, y: 210, w: 172 },
  { key: 'taxi', x: 424, y: 210, w: 172 },
  { key: 'apartment', x: 20, y: 374, w: 196 },
  { key: 'shop', x: 384, y: 374, w: 196 },
] as const;

const FLOWS = [
  'M118 72 Q190 120 258 196',
  'M482 72 Q410 120 342 196',
  'M80 236 L222 236',
  'M520 236 L378 236',
  'M118 400 Q190 350 258 276',
  'M482 400 Q410 350 342 276',
];

function NetworkMap({ t }: { t: T }) {
  const hub = t('public.landing.map.hub');
  const hubSub = t('public.landing.map.hubSub');
  return (
    <svg viewBox="0 0 600 470" role="img" aria-label={t('public.landing.map.label')}>
      <defs>
        <radialGradient id="landing-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#0C8A84" stopOpacity=".16" />
          <stop offset="1" stopColor="#0C8A84" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="300" cy="235" r="200" fill="url(#landing-glow)" />
      <circle
        cx="300"
        cy="235"
        r="150"
        fill="none"
        stroke="#D6E4EA"
        strokeWidth="1.5"
        strokeDasharray="2 6"
      />
      {FLOWS.map((d) => (
        <path key={d} className={styles.flow} d={d} />
      ))}
      <circle cx="300" cy="235" r="82" fill="#0F2A3A" />
      <g
        transform="translate(277 168)"
        fill="none"
        stroke="#F5A623"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 26h42l-6 9H8z" />
        <path d="M23 4v20M23 6l14 16H23" />
      </g>
      <text
        className={styles.hubLabel}
        x="300"
        y="240"
        textAnchor="middle"
        fontSize={fit(hub, 21, 132, 0.52)}
      >
        {hub}
      </text>
      <text
        className={styles.hubSub}
        x="300"
        y="263"
        textAnchor="middle"
        fontSize={fit(hubSub, 14, 120, 0.5)}
      >
        {hubSub}
      </text>
      {NODES.map((node) => {
        const label = t(`public.landing.map.nodes.${node.key}`);
        return (
          <g key={node.key} className={styles.node} transform={`translate(${node.x} ${node.y})`}>
            <rect width={node.w} height="52" rx="26" />
            <circle className={styles.coin} cx="26" cy="26" r="12" />
            <text x="46" y="32" fontSize={fit(label, 17, node.w - 46 - 18, 0.54)}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- how it works ---------- */

function HowItWorks({ t }: { t: T }) {
  const name = t('public.landing.person.name');
  const first = t('public.landing.person.first');
  const promoter = <b className={styles.promoterTag}>{t('public.landing.who.promoter')}</b>;
  const you = <b>{t('public.landing.who.you')}</b>;
  return (
    <section aria-labelledby="how-title">
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>{t('public.landing.how.eyebrow')}</p>
        <h2 id="how-title">{t('public.landing.how.title')}</h2>
      </div>
      <ol className={styles.steps}>
        <Step
          n={1}
          who={promoter}
          title={t('public.landing.step1.title')}
          text={t('public.landing.step1.text')}
        >
          <SignupPhone t={t} name={name} />
        </Step>
        <Step
          n={2}
          who={you}
          title={t('public.landing.step2.title')}
          text={t('public.landing.step2.text')}
        >
          <ApprovalCard t={t} name={name} />
        </Step>
        <Step
          n={3}
          who={promoter}
          title={t('public.landing.step3.title')}
          text={t('public.landing.step3.text')}
        >
          <QrChain t={t} first={first} />
        </Step>
        <Step
          n={4}
          who={
            <>
              {you} {promoter}
            </>
          }
          title={t('public.landing.step4.title')}
          text={t('public.landing.step4.text')}
        >
          <MoneySplit t={t} first={first} />
        </Step>
      </ol>
    </section>
  );
}

function Step({
  n,
  who,
  title,
  text,
  children,
}: {
  n: number;
  who: ReactNode;
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <li className={styles.step}>
      <div className={styles.stepText}>
        <span className={styles.num} aria-hidden="true">
          {n}
        </span>
        <span className={styles.who}>{who}</span>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      {/* Illustrations of the app's screens: the text beside them says the same thing. */}
      <div className={styles.visual} aria-hidden="true">
        {children}
      </div>
    </li>
  );
}

function SignupPhone({ t, name }: { t: T; name: string }) {
  return (
    <div className={styles.phone}>
      <div className={styles.screen}>
        <div className={styles.notch} />
        <h4>{t('public.landing.step1.mockTitle')}</h4>
        <div className={styles.field}>
          <small>{t('public.landing.step1.name')}</small>
          <span>{name}</span>
        </div>
        <div className={styles.field}>
          <small>{t('public.landing.step1.where')}</small>
          <span>{t('public.landing.step1.workplace')}</span>
        </div>
        <div className={styles.field}>
          <small>{t('public.landing.step1.phone')}</small>
          <span>+40 7•• ••• 214</span>
        </div>
        <div className={styles.btn}>{t('public.landing.step1.send')}</div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');
}

function ApprovalCard({ t, name }: { t: T; name: string }) {
  return (
    <div className={styles.card}>
      <div className={styles.req}>
        <span className={styles.avatar}>{initials(name)}</span>
        <div>
          <b>{name}</b>
          <div className={styles.muted}>{t('public.landing.step2.request')}</div>
        </div>
      </div>
      <div className={styles.choice}>
        <div className={styles.choiceHead}>
          <span>{t('public.landing.step2.fixed')}</span>
          <span className={styles.radio} />
        </div>
        <div className={styles.muted}>{t('public.landing.step2.fixedText')}</div>
      </div>
      <div className={`${styles.choice} ${styles.choiceOn}`}>
        <div className={styles.choiceHead}>
          <span>{t('public.landing.step2.standard')}</span>
          <span className={styles.radio} />
        </div>
        <div className={styles.ladder}>
          <div>
            15%<small>{t('public.landing.step2.tier1')}</small>
          </div>
          <div>
            20%<small>{t('public.landing.step2.tier2')}</small>
          </div>
          <div>
            25%<small>{t('public.landing.step2.tier3')}</small>
          </div>
        </div>
        <div className={styles.reset}>{t('public.landing.step2.reset')}</div>
      </div>
      <div className={styles.btn}>{t('public.landing.step2.approve')}</div>
    </div>
  );
}

/** Decorative QR: the three finder patterns plus a fixed pseudo-random fill (seeded, so stable). */
function qrPath(): string {
  const n = 25;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (inFinder(x, y)) continue;
      if (rnd() > 0.52) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
}

const QR_PATH = qrPath();

const ICON = {
  fill: 'none',
  stroke: '#0C8A84',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
} as const;

function QrChain({ t, first }: { t: T; first: string }) {
  const finders = [
    [0, 0],
    [18, 0],
    [0, 18],
  ] as const;
  const chain = [
    {
      key: 'scan',
      icon: (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3M21 21h-4M21 14v3" />
        </>
      ),
    },
    {
      key: 'pick',
      icon: (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </>
      ),
    },
    {
      key: 'pay',
      icon: (
        <>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20M6 15h4" />
        </>
      ),
    },
    {
      key: 'ticket',
      icon: (
        <>
          <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" />
          <path d="m9 12 2 2 4-4" />
        </>
      ),
    },
  ] as const;
  return (
    <>
      <div className={styles.qrbox}>
        <svg viewBox="0 0 25 25" shapeRendering="crispEdges">
          <title>{t('public.landing.step3.qrLabel')}</title>
          <rect width="25" height="25" fill="#fff" />
          <path d={QR_PATH} fill="#0F2A3A" />
          {finders.map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <rect x={x} y={y} width="7" height="7" fill="#0F2A3A" />
              <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
              <rect x={x + 2} y={y + 2} width="3" height="3" fill="#0C8A84" />
            </g>
          ))}
          <rect x="10" y="10" width="5" height="5" rx="1" fill="#F5A623" />
        </svg>
        <code>{`${first.toLocaleUpperCase()} · ASTORIA`}</code>
      </div>
      <ul className={styles.chain}>
        {chain.map((item) => (
          <li key={item.key} className={styles.link}>
            <svg width="20" height="20" {...ICON}>
              {item.icon}
            </svg>
            <span>{t(`public.landing.step3.${item.key}`)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function MoneySplit({ t, first }: { t: T; first: string }) {
  return (
    <div className={styles.split}>
      <div className={styles.ticket}>
        <div>
          <b>{t('public.landing.step4.trip')}</b>
          <div className={styles.muted}>{t('public.landing.step4.tripMeta')}</div>
        </div>
        <strong>€90</strong>
      </div>
      <div className={styles.bar}>
        <div className={styles.barYou}>
          €72<small>{t('public.landing.step4.forYou')}</small>
        </div>
        <div className={styles.barPromoter}>
          €18<small>{first}</small>
        </div>
      </div>
      <div className={styles.month}>
        <div>
          <span>{t('public.landing.step4.sales')}</span>
          <b>9</b>
        </div>
        <div>
          <span>{t('public.landing.step4.earned')}</span>
          <b className={styles.gold}>€162</b>
        </div>
      </div>
      <div className={styles.auto}>
        <svg width="16" height="16" {...ICON} strokeWidth={2.6}>
          <path d="m5 12 5 5L20 7" />
        </svg>
        <span>{t('public.landing.step4.auto')}</span>
      </div>
    </div>
  );
}

/* ---------- everyone is happy ---------- */

const WINS = [
  {
    key: 'owner',
    className: styles.w1,
    icon: (
      <svg width="28" height="28" {...ICON}>
        <path d="M2 17h20l-3 4H5z" />
        <path d="M12 3v12M12 4l7 9h-7" />
      </svg>
    ),
  },
  {
    key: 'promoter',
    className: styles.w2,
    icon: (
      <svg width="28" height="28" {...ICON} stroke="#B26B00">
        <circle cx="12" cy="12" r="9" />
        <path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.6-.6-3-1.6M12 6v2M12 16v2" />
      </svg>
    ),
  },
  {
    key: 'guest',
    className: styles.w3,
    icon: (
      <svg width="28" height="28" {...ICON} stroke="#C2412D">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    ),
  },
] as const;

function Wins({ t }: { t: T }) {
  return (
    <section aria-labelledby="wins-title">
      <div className={styles.sectionHead}>
        <p className={styles.eyebrow}>{t('public.landing.wins.eyebrow')}</p>
        <h2 id="wins-title">{t('public.landing.wins.title')}</h2>
      </div>
      <ul className={styles.wins}>
        {WINS.map((win) => (
          <li key={win.key} className={`${styles.win} ${win.className}`}>
            <span className={styles.ico} aria-hidden="true">
              {win.icon}
            </span>
            <h3>{t(`public.landing.wins.${win.key}.title`)}</h3>
            <p>{t(`public.landing.wins.${win.key}.text`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- already included ---------- */

const INCLUDED = [
  {
    key: 'payments',
    icon: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </>
    ),
  },
  {
    key: 'tickets',
    icon: (
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" />
    ),
  },
  {
    key: 'scanner',
    icon: (
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />
    ),
  },
  { key: 'report', icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
  {
    key: 'languages',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
  },
  {
    key: 'phones',
    icon: (
      <>
        <rect x="6" y="2" width="12" height="20" rx="2.5" />
        <path d="M11 18h2" />
      </>
    ),
  },
] as const;

function Included({ t }: { t: T }) {
  return (
    <section className={styles.incl} aria-labelledby="incl-title">
      <p className={styles.eyebrow}>{t('public.landing.included.eyebrow')}</p>
      <h2 id="incl-title">{t('public.landing.included.title')}</h2>
      <ul>
        {INCLUDED.map((item) => (
          <li key={item.key}>
            <svg width="24" height="24" {...ICON} aria-hidden="true">
              {item.icon}
            </svg>
            <b>{t(`public.landing.included.${item.key}.title`)}</b>
            <span>{t(`public.landing.included.${item.key}.text`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- closing ---------- */

function Closing({ t }: { t: T }) {
  return (
    <section className={styles.closing} aria-labelledby="closing-title">
      <svg
        className={styles.waves}
        viewBox="0 0 300 120"
        fill="none"
        stroke="#F5A623"
        strokeWidth="4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M0 30q25-20 50 0t50 0 50 0 50 0 50 0 50 0" />
        <path d="M0 65q25-20 50 0t50 0 50 0 50 0 50 0 50 0" />
        <path d="M0 100q25-20 50 0t50 0 50 0 50 0 50 0 50 0" />
      </svg>
      <p className={styles.eyebrow}>{t('public.landing.closing.eyebrow')}</p>
      <h2 id="closing-title">
        {t('public.landing.closing.title')} <em>{t('public.landing.closing.emphasis')}</em>
      </h2>
      <p className={styles.closingText}>{t('public.landing.closing.text')}</p>
      <Ctas t={t} />
    </section>
  );
}

import Link from 'next/link';
import { ButtonLink } from '@/components/Button';
import { IconCalendarPlus, IconPercent, IconQr, IconTicket } from '@/components/icons';
import { APP_NAME } from '@/lib/brand';

const FEATURES = [
  {
    icon: <IconQr size={28} />,
    title: 'Un cod QR pentru fiecare afiliat',
    text: 'Recepționerul arată codul, turistul îl scanează și rezervă singur. Fiecare vânzare ajunge la cine a recomandat-o.',
  },
  {
    icon: <IconCalendarPlus size={28} />,
    title: 'Rezervare în 30 de secunde',
    text: 'Afiliatul rezervă direct de pe telefon, iar clientul plătește scanând un cod sau din linkul primit pe WhatsApp.',
  },
  {
    icon: <IconPercent size={28} />,
    title: 'Comisioane fixe sau progresive',
    text: 'Stabilești procentul sau niveluri care cresc cu vânzările. Afiliații își văd câștigurile în timp real.',
  },
  {
    icon: <IconTicket size={28} />,
    title: 'Bilete cu cod QR la îmbarcare',
    text: 'Turistul primește biletul pe telefon; la îmbarcare îl scanezi cu camera, fără aplicații în plus.',
  },
];

const STEPS = [
  'Îți adaugi excursiile, prețurile și plecările.',
  'Inviți recepționeri, concierge și ghizi ca afiliați.',
  'Ei recomandă cu codul QR sau rezervă pentru turist.',
  'Turistul plătește online; comisionul se calculează singur.',
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header
        className="page-x mx-auto flex max-w-5xl items-center justify-between gap-4 py-4"
        style={{ paddingTop: 'max(1rem, var(--safe-top))' }}
      >
        <Link href="/" className="flex min-h-12 items-center gap-2 text-lg font-bold">
          <img src="/icons/icon.svg" alt="" width={36} height={36} className="rounded-xl" />
          {APP_NAME}
        </Link>
        <ButtonLink href="/login" variant="secondary">
          Intră în cont
        </ButtonLink>
      </header>

      <main id="content">
        <section className="page-x mx-auto max-w-5xl py-10 sm:py-16" aria-labelledby="hero-title">
          <p className="mb-3 font-semibold text-brand">
            Pentru operatori de excursii și plimbări cu barca
          </p>
          <h1
            id="hero-title"
            className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl"
          >
            Recepționerii îți vând excursiile. Tu plătești doar comision.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">
            Construiește-ți propria rețea de afiliați: hoteluri, pensiuni și ghizi care recomandă
            turiștilor plimbările tale, cu linkuri, coduri QR și comisioane calculate automat.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/start" size="lg">
              Începe gratuit
            </ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary">
              Intră în cont
            </ButtonLink>
            <ButtonLink href="#cum-functioneaza" size="lg" variant="ghost">
              Cum funcționează
            </ButtonLink>
          </div>
        </section>

        <section className="page-x mx-auto max-w-5xl pb-12" aria-labelledby="features-title">
          <h2 id="features-title" className="visually-hidden">
            Ce primești
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="rounded-3xl border border-line bg-surface p-5">
                <div className="mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-soft-fg">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-1 text-muted">{feature.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="cum-functioneaza"
          className="page-x mx-auto max-w-5xl pb-16"
          aria-labelledby="how-title"
        >
          <h2 id="how-title" className="text-2xl font-bold">
            Cum funcționează
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand font-bold text-on-brand">
                  {i + 1}
                </span>
                <span className="pt-1">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer
        className="page-x mx-auto max-w-5xl border-t border-line py-6 text-sm text-muted"
        style={{ paddingBottom: 'max(1.5rem, var(--safe-bottom))' }}
      >
        © {new Date().getFullYear()} {APP_NAME}
      </footer>
    </div>
  );
}

/**
 * Tiny dictionary-based i18n for the public (tourist) pages: booking, ticket and test payment.
 * Language comes from `?lang=`, then the browser language, then English.
 * Affiliate and operator screens are Romanian only and do not use this.
 */

export const LANGS = ['ro', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

const en = {
  langName: 'English',
  language: 'Language',
  loading: 'Loading…',
  retry: 'Try again',
  errorGeneric: 'Something went wrong. Please try again.',
  errorNetwork: 'No internet connection. Check your connection and try again.',
  back: 'Back',

  productsTitle: 'Trips and experiences',
  fromPrice: 'from {price}',
  book: 'Book',
  noProducts: 'No trips are available right now.',
  tenantNotFound: 'We could not find this operator.',
  productNotFound: 'We could not find this trip.',
  goHome: 'Go to the home page',

  chooseDate: 'Choose a date',
  chooseTime: 'Choose a time',
  today: 'Today',
  tomorrow: 'Tomorrow',
  noDeparturesOnDay: 'No departures on this day. Pick another date.',
  noDepartures: 'There are no departures in the next 14 days.',
  seatsLeft_one: '1 seat left',
  seatsLeft_other: '{count} seats left',
  soldOut: 'Sold out',
  tickets: 'Tickets',
  total: 'Total',
  notEnoughSeats_one: 'Only 1 seat is left on this departure.',
  notEnoughSeats_other: 'Only {count} seats are left on this departure.',
  selectTickets: 'Choose at least one ticket.',
  add: 'Add one {label}',
  remove: 'Remove one {label}',
  meetingPoint: 'Meeting point',
  duration: 'Duration',
  stepOf: 'Step {step} of {total}',
  stepWhen: 'Date and time',
  stepTickets: 'Tickets',
  stepDetails: 'Your details',
  continue: 'Continue',
  change: 'Change',

  yourDetails: 'Your details',
  name: 'Full name',
  email: 'Email',
  phone: 'Mobile phone',
  contactHint: 'We send your ticket by email or text message. Fill in at least one.',
  phoneHint: 'Include the country code, e.g. +44 7700 900123',
  errorName: 'Please enter your name.',
  errorContact: 'Please enter an email address or a phone number.',
  errorEmail: 'This email address does not look right.',
  errorPhone: 'Enter the number with its country code, e.g. +44 7700 900123.',
  payNow: 'Pay {amount}',
  redirecting: 'Taking you to the payment page…',
  securePayment: 'Secure payment. Your ticket arrives right after.',
  slotGone: 'This departure is no longer available. Please choose another time.',
  paymentUnavailable:
    'Online payment is not available right now. Please try again in a few minutes.',
  checkFields: 'Please check the highlighted fields.',
  chooseTimeFirst: 'Choose a date and a time first.',
  perPerson: 'per person',

  ticketTitle: 'Your ticket',
  showAtBoarding: 'Show this code when you board.',
  downloadPdf: 'Save ticket as PDF',
  downloadPdfHint: 'Keep it on your phone; no need to print it.',
  statusValid: 'Valid',
  statusCheckedIn: 'Used',
  checkedInText: 'This ticket was scanned at boarding. Enjoy the trip!',
  statusVoid: 'Not valid',
  voidText: 'This ticket is no longer valid. Contact the operator if you think this is a mistake.',
  statusPending: 'Waiting for payment',
  pendingText: 'We are confirming your payment. This page updates by itself.',
  reference: 'Booking reference',
  when: 'When',
  guests: 'Guests',
  guestCount_one: '1 person',
  guestCount_other: '{count} people',
  bookedBy: 'Name',
  dueOnSite: 'To pay at boarding',
  paidOnline: 'Paid online',
  operator: 'Operator',
  addToHomeTitle: 'Keep your ticket on your phone',
  addToHomeIos: 'Tap the Share button, then “Add to Home Screen”.',
  addToHomeOther: 'Open the browser menu and choose “Add to Home screen” or “Install”.',
  install: 'Add to home screen',
  ticketNotFound: 'We could not find this ticket. Please check the link you received.',
  offlineTicket: 'You are offline. This is the last saved copy of your ticket.',

  devPayTitle: 'Test payment',
  devPayNote: 'Test mode: no card is charged.',
  cardNumber: 'Card number',
  expiry: 'Expiry date',
  cvc: 'Security code',
  cardholder: 'Name on card',
  pay: 'Pay',
  paying: 'Processing…',
  payFailed: 'The payment did not go through. Please try again.',
} as const;

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const ro: Dictionary & Record<string, string> = {
  langName: 'Română',
  language: 'Limba',
  loading: 'Se încarcă…',
  retry: 'Încearcă din nou',
  errorGeneric: 'Ceva n-a mers. Încearcă din nou.',
  errorNetwork: 'Nu ai conexiune la internet. Verifică și încearcă din nou.',
  back: 'Înapoi',

  productsTitle: 'Excursii și experiențe',
  fromPrice: 'de la {price}',
  book: 'Rezervă',
  noProducts: 'Momentan nu sunt excursii disponibile.',
  tenantNotFound: 'Nu am găsit acest operator.',
  productNotFound: 'Nu am găsit această excursie.',
  goHome: 'Mergi la prima pagină',

  chooseDate: 'Alege data',
  chooseTime: 'Alege ora',
  today: 'Azi',
  tomorrow: 'Mâine',
  noDeparturesOnDay: 'Nu sunt plecări în această zi. Alege altă dată.',
  noDepartures: 'Nu sunt plecări în următoarele 14 zile.',
  seatsLeft_one: '1 loc liber',
  seatsLeft_few: '{count} locuri libere',
  seatsLeft_other: '{count} de locuri libere',
  soldOut: 'Complet',
  tickets: 'Bilete',
  total: 'Total',
  notEnoughSeats_one: 'Mai este doar 1 loc liber la această plecare.',
  notEnoughSeats_few: 'Mai sunt doar {count} locuri libere la această plecare.',
  notEnoughSeats_other: 'Mai sunt doar {count} de locuri libere la această plecare.',
  selectTickets: 'Alege cel puțin un bilet.',
  add: 'Adaugă un bilet {label}',
  remove: 'Scoate un bilet {label}',
  meetingPoint: 'Punct de întâlnire',
  duration: 'Durată',
  stepOf: 'Pasul {step} din {total}',
  stepWhen: 'Data și ora',
  stepTickets: 'Bilete',
  stepDetails: 'Datele tale',
  continue: 'Continuă',
  change: 'Schimbă',

  yourDetails: 'Datele tale',
  name: 'Nume și prenume',
  email: 'Email',
  phone: 'Telefon mobil',
  contactHint: 'Îți trimitem biletul pe email sau prin SMS. Completează cel puțin unul.',
  phoneHint: 'Cu prefixul țării, ex. +40 722 123 456',
  errorName: 'Scrie numele tău.',
  errorContact: 'Scrie o adresă de email sau un număr de telefon.',
  errorEmail: 'Adresa de email nu pare corectă.',
  errorPhone: 'Scrie numărul cu prefixul țării, ex. +40 722 123 456.',
  payNow: 'Plătește {amount}',
  redirecting: 'Te ducem la plată…',
  securePayment: 'Plată securizată. Primești biletul imediat după.',
  slotGone: 'Această plecare nu mai este disponibilă. Alege altă oră.',
  paymentUnavailable: 'Plata online nu este disponibilă acum. Încearcă din nou în câteva minute.',
  checkFields: 'Verifică câmpurile marcate.',
  chooseTimeFirst: 'Alege mai întâi data și ora.',
  perPerson: 'de persoană',

  ticketTitle: 'Biletul tău',
  showAtBoarding: 'Arată acest cod la îmbarcare.',
  downloadPdf: 'Salvează biletul PDF',
  downloadPdfHint: 'Îl păstrezi pe telefon, nu trebuie printat.',
  statusValid: 'Valabil',
  statusCheckedIn: 'Folosit',
  checkedInText: 'Biletul a fost scanat la îmbarcare. Distracție plăcută!',
  statusVoid: 'Nevalabil',
  voidText: 'Acest bilet nu mai este valabil. Contactează operatorul dacă e o greșeală.',
  statusPending: 'Așteptăm plata',
  pendingText: 'Confirmăm plata. Pagina se actualizează singură.',
  reference: 'Cod rezervare',
  when: 'Când',
  guests: 'Persoane',
  guestCount_one: '1 persoană',
  guestCount_few: '{count} persoane',
  guestCount_other: '{count} de persoane',
  bookedBy: 'Nume',
  dueOnSite: 'De plătit la îmbarcare',
  paidOnline: 'Plătit online',
  operator: 'Operator',
  addToHomeTitle: 'Păstrează biletul pe telefon',
  addToHomeIos: 'Apasă butonul Distribuie, apoi „Adaugă pe ecranul principal”.',
  addToHomeOther:
    'Deschide meniul browserului și alege „Adaugă pe ecranul principal” sau „Instalează”.',
  install: 'Adaugă pe ecran',
  ticketNotFound: 'Nu am găsit biletul. Verifică linkul primit.',
  offlineTicket: 'Nu ai conexiune. Aceasta este ultima copie salvată a biletului.',

  devPayTitle: 'Plată de test',
  devPayNote: 'Mod de test: niciun card nu este debitat.',
  cardNumber: 'Număr card',
  expiry: 'Data expirării',
  cvc: 'Cod de securitate',
  cardholder: 'Numele de pe card',
  pay: 'Plătește',
  paying: 'Se procesează…',
  payFailed: 'Plata nu a reușit. Încearcă din nou.',
};

const dictionaries: Record<Lang, Record<string, string>> = { en, ro };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** Maps a BCP 47 tag ("ro-RO", "en-US", "mo") to a supported language, or null. */
export function langFromTag(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (base === 'ro' || base === 'mo') return 'ro';
  if (base === 'en') return 'en';
  return null;
}

/** First supported language of an `Accept-Language` header. */
export function langFromAcceptLanguage(header: string | null | undefined): Lang | null {
  if (!header) return null;
  const tags = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag ?? '', q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((t) => t.tag && !Number.isNaN(t.q))
    .sort((a, b) => b.q - a.q);
  // Only the most preferred language decides: a German visitor gets English, not Romanian.
  return langFromTag(tags[0]?.tag);
}

/** `?lang=` wins, then the browser language, then English. */
export function pickLang(queryLang?: string | null, browserLanguage?: string | null): Lang {
  return langFromTag(queryLang) ?? langFromTag(browserLanguage) ?? DEFAULT_LANG;
}

type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : match,
  );
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const template = dictionaries[lang][key] ?? en[key];
  return interpolate(template, vars);
}

type PluralBase<K extends string> = K extends `${infer B}_other` ? B : never;
export type PluralKey = PluralBase<MessageKey>;

/** Plural-aware message: picks `<key>_one` / `<key>_few` / `<key>_other` with Intl.PluralRules. */
export function translatePlural(lang: Lang, key: PluralKey, count: number, vars?: Vars): string {
  const category = new Intl.PluralRules(lang).select(count);
  const dict = dictionaries[lang];
  const template =
    dict[`${key}_${category}`] ??
    dict[`${key}_other`] ??
    (en as Record<string, string>)[`${key}_other`] ??
    key;
  return interpolate(template, { count, ...vars });
}

/** Bound helpers for one language. */
export function getT(lang: Lang) {
  return {
    lang,
    t: (key: MessageKey, vars?: Vars) => translate(lang, key, vars),
    tp: (key: PluralKey, count: number, vars?: Vars) => translatePlural(lang, key, count, vars),
  };
}

export type Translator = ReturnType<typeof getT>;

/** Romanian plural for the affiliate/operator screens: 1 vânzare, 2 vânzări, 20 de vânzări. */
export function pluralRo(count: number, one: string, few: string, other = `de ${few}`): string {
  const category = new Intl.PluralRules('ro').select(count);
  if (category === 'one') return `${count} ${one}`;
  if (category === 'few') return `${count} ${few}`;
  return `${count} ${other}`;
}

/** "1 h 30 min" style duration. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

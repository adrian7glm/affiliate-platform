import { pluralRo } from './i18n';

/**
 * Words used by the boarding screens: the ticket scanner (operator and scanner accounts) and the
 * boarding team page. Kept in one dictionary so the screens can be translated as a whole.
 */
export const BOARDING_TEXT = {
  // Scanner
  scanTitle: 'Scanează bilete',
  scanDescription: 'Ține codul QR al clientului în cadru. Verificarea pornește singură.',
  cameraImage: 'Imaginea camerei',
  cameraStarting: 'Pornește camera…',
  checking: 'Se verifică biletul…',
  manualSummary: 'Nu merge camera? Introdu biletul manual',
  manualLabel: 'Linkul sau codul biletului',
  manualHint: 'Linkul primit de client (…/t/…) sau codul copiat de pe bilet.',
  manualEmpty: 'Lipește codul sau linkul biletului.',
  manualSubmit: 'Verifică biletul',
  ticketNotFound: 'Nu am găsit biletul. Verifică linkul.',
  cameraBlockedTitle: 'Camera este blocată',
  cameraBlockedText:
    'Permite accesul la cameră din setările browserului pentru acest site, apoi apasă din nou.',
  tryAgain: 'Încearcă din nou',
  noCameraTitle: 'Nu am găsit o cameră',
  noCameraText:
    'Pe acest dispozitiv nu este disponibilă o cameră. Poți introduce biletul manual mai jos.',
  cameraPrompt: 'Folosește camera telefonului pentru a citi biletele la îmbarcare.',
  cameraFailed: 'Camera nu a pornit. Încearcă din nou.',
  startCamera: 'Pornește camera',

  resultCheckedIn: 'Îmbarcare confirmată',
  resultAlreadyUsed: 'Bilet deja folosit',
  resultNotValid: 'Bilet nevalabil',
  resultError: 'Nu am putut verifica biletul',
  notValidUnknown: 'Codul nu este un bilet al tău sau este deteriorat.',
  notValidUnpaid: 'Rezervarea nu a fost plătită.',
  notValidCancelled: 'Rezervarea a fost anulată sau rambursată.',
  /** Shown on a second scan: "Scanat la 10:52 de Mihai". */
  usedAt: 'Scanat {when}',
  usedAtBy: 'Scanat {when} de {who}',
  usedToday: 'azi la {time}',
  usedOnDay: '{day}, ora {time}',
  payOnSite: 'Plată la îmbarcare',
  collect: 'Încasează',
  collectBookingAmount: 'Încasează suma rezervării de la client.',
  otherDayWarning: 'Atenție: biletul este pentru {day}.',
  customer: 'Client',
  trip: 'Excursie',
  seats: 'Locuri',
  reference: 'Referință',
  tickets: 'Bilete',
  scanNext: 'Scanează următorul',

  // Scanner app shell (/s)
  scannerAppTitle: 'Scaner bilete',
  scannedTodayNone: 'Azi nu ai scanat încă bilete',
  scannedToday: 'Azi ai scanat {tickets}',
  ticketOne: 'bilet',
  ticketFew: 'bilete',
  logout: 'Ieși din cont',
  operator: 'Operator',

  // Boarding team page (/o/team)
  teamNav: 'Echipa la îmbarcare',
  teamTitle: 'Echipa la îmbarcare',
  teamDescription:
    'Conturi pentru cei care scanează biletele la plecare. Ei văd doar scanerul, nu și rezervările, afiliații sau banii.',
  teamAdd: 'Adaugă o persoană',
  teamName: 'Nume',
  teamNameHint: 'Cum apare la biletele scanate, de exemplu „Mihai, ponton”.',
  teamContact: 'Telefon sau email',
  teamContactHint: 'Aici primește linkul de intrare și codurile de conectare.',
  teamSubmit: 'Creează contul',
  teamAdded: '{name} a primit linkul de intrare.',
  teamErrorName: 'Scrie numele persoanei.',
  teamErrorContact: 'Scrie un număr de telefon (ex. 0722 123 456) sau o adresă de email.',
  teamErrorDuplicate: 'Persoana are deja cont de scanare.',
  teamEmpty: 'Nu ai încă pe nimeni la îmbarcare. Adaugă prima persoană mai sus.',
  teamListTitle: 'Persoane cu acces la scaner',
  teamLastScan: 'Ultima scanare: {when}',
  teamNeverScanned: 'Nu a scanat încă bilete',
  teamRemove: 'Scoate accesul',
  teamRemoveTitle: 'Scoți accesul lui {name}?',
  teamRemoveText:
    'Nu va mai putea scana bilete. Biletele scanate deja rămân trecute pe numele lui.',
  teamRemoveConfirm: 'Da, scoate accesul',
  cancel: 'Renunță',
  teamHowTo:
    'Persoana deschide linkul primit, intră cu codul din SMS sau email și ajunge direct la scaner.',
  noName: 'Fără nume',
} as const;

export type BoardingTextKey = keyof typeof BOARDING_TEXT;

/** Looks up a boarding text and fills in its {placeholders}. */
export function bt(key: BoardingTextKey, vars?: Record<string, string | number>): string {
  const text: string = BOARDING_TEXT[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** "Azi ai scanat N bilete", with the right Romanian plural. */
export function scannedToday(count: number): string {
  if (count === 0) return bt('scannedTodayNone');
  return bt('scannedToday', { tickets: pluralRo(count, bt('ticketOne'), bt('ticketFew')) });
}

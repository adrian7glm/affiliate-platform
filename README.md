# Affiliate Platform

SaaS de afiliere pentru operatori de turism (plimbări cu barca, excursii, experiențe):
fiecare operator își construiește propria rețea de afiliați (recepționeri, concierge, ghizi),
cu linkuri și coduri QR, comisioane fixe sau progresive, rezervări instant și plăți Stripe.

## Ce conține

| Pachet                | Rol                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/api`            | API NestJS (monolit modular): login, afiliați, linkuri/QR, rezervări, bilete, plăți, comisioane     |
| `apps/web`            | Aplicația web mobile-first (PWA) pentru afiliați, operator și clienți                               |
| `packages/commission` | Motorul de comisioane: procent fix sau progresiv pe praguri, cu reset lunar (fără dependențe de DB) |
| `packages/db`         | Schema Postgres (Drizzle), migrări, registrul de comisioane append-only                             |
| `packages/contracts`  | Tipurile și validările comune pentru API și evenimente                                              |
| `packages/adapters`   | Conectorii de disponibilitate: calendar intern și adaptor REST către sistemul operatorului          |
| `packages/i18n`       | Traducerile: un fișier `.json` pe limbă, folosit de ecrane, emailuri, SMS, bilete și erorile API    |

Documentație: [`docs/api.md`](docs/api.md) (toate endpoint-urile) și
[`docs/rest-adapter.md`](docs/rest-adapter.md) (ce trebuie să expună sistemul unui operator ca
să-i vedem disponibilitatea în timp real).

## Pornire locală

Ai nevoie de Node 22, pnpm 10 (`corepack enable`) și Docker.

```bash
pnpm install
docker compose up -d                       # Postgres: baza "affiliate" + "affiliate_test"
cp apps/api/.env.example apps/api/.env
pnpm build
pnpm db:migrate                            # creează tabelele
pnpm db:seed                               # operator demo, plan progresiv, o excursie, un afiliat
pnpm dev                                   # API pe :4000, aplicația web pe :3000
```

Date demo după `pnpm db:seed`:

- proprietarul platformei: `admin@demo.test` (deschide `/admin`: operatori, planuri și tarife, invitații)
- operator: `owner@demo.test` (operatorul „Delta Boats”, excursia „Plimbare cu barca la apus”)
- afiliat: `+40700000001` (Ana), cu plan progresiv 15% / 20% / 25% pe lună

Login-ul se face cu cod unic (fără parolă), trimis prin SMS sau email. Local, codul apare în
log-ul API-ului.
Plățile folosesc implicit un procesator de test (`PAYMENTS_PROVIDER=fake`): după checkout se
deschide o pagină locală de plată, fără cont Stripe. Pentru Stripe real, setează
`PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY` și `STRIPE_WEBHOOK_SECRET` în `apps/api/.env`.

## SMS și email

Platforma trimite: codurile de login, invitațiile pentru afiliați, linkul de plată (rezervare
făcută de afiliat), biletul cu cod QR și anunțul de anulare/rambursare. Mesajele pentru clienți
sunt în română sau engleză, după limba aleasă la rezervare; SMS-urile sunt fără diacritice ca
să încapă în mai puține segmente. Toate mesajele intră într-o coadă (tabela `notifications`)
și sunt trimise de worker cu reîncercări, deci o pană a furnizorului doar întârzie un bilet.

Pe lângă acestea, worker-ul trimite singur mesajele care îi fac pe toți să revină:

- **clienților**: o reamintire în seara dinaintea excursiei (ora 18, cu punctul de întâlnire și
  biletul) și, a doua zi la ora 10, o cerere de recenzie cu linkul operatorului (Google,
  TripAdvisor), doar celor care s-au îmbarcat când echipajul scanează biletele;
- **afiliaților**: „ai făcut o vânzare” cu comisionul și câte vânzări mai are până la nivelul
  următor, „mai ai X vânzări până la Y%” în ultimele 5 zile ale lunii și „ți-am plătit
  comisionul” când operatorul marchează plata; afiliatul le poate opri din aplicație;
- **operatorilor**: raportul lunii trecute pe 1 ale lunii, la ora 8 (rezervări, încasări, cât au
  adus afiliații, comisioane de plătit), un email cu 3 zile înainte de sfârșitul perioadei de
  probă, unul când abonamentul rămâne neplătit și unul când rezervările noi se opresc.

Orele sunt în fusul orar al operatorului. Operatorul alege din Setări care mesaje pleacă și unde
duce linkul de recenzie. Un abonament neplătit (probă terminată, plată eșuată sau perioadă
plătită expirată) oprește rezervările noi după `BILLING_GRACE_DAYS` zile (implicit 7); biletele
deja vândute rămân valabile.

Local, mesajele apar în log-ul API-ului (`EMAIL_PROVIDER=console`, `SMS_PROVIDER=console`).
Pentru trimitere reală, în `apps/api/.env`:

| Variabilă                                        | Valoare                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `EMAIL_PROVIDER`                                 | `smtp` (orice furnizor: Resend, Amazon SES, Brevo, Mailgun, Postmark…)     |
| `SMTP_URL`                                       | ex. `smtps://resend:re_xxx@smtp.resend.com:465`                            |
| `EMAIL_FROM`                                     | ex. `Delta Boats <bilete@domeniul-tau.ro>` (domeniu verificat la furnizor) |
| `SMS_PROVIDER`                                   | `twilio`                                                                   |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`        | din consola Twilio                                                         |
| `TWILIO_FROM` sau `TWILIO_MESSAGING_SERVICE_SID` | numărul Twilio (`+40...`) sau un nume de expeditor de max. 11 caractere    |

Oricare canal poate fi oprit cu `disabled`. În producție `console` nu este permis.

## Limbi și traduceri

Toate textele (ecranele afiliatului, ale operatorului și ale adminului, pagina publică de
rezervare, biletul, emailurile, SMS-urile și mesajele de eroare ale API-ului) sunt în
`packages/i18n/src/locales/<limbă>.json`. Platforma vine cu 9 limbi complete: română (`ro`),
engleză (`en`, limba de referință: orice text lipsă dintr-o limbă apare în engleză), germană
(`de`), franceză (`fr`), spaniolă (`es`), italiană (`it`), portugheză (`pt`), rusă (`ru`) și
ucraineană (`uk`).

- **Selectorul de limbă** apare pe pagina publică, la login și în meniurile afiliatului,
  operatorului și adminului. Alegerea se păstrează pe telefon. Turiștii primesc automat limba
  browserului, dacă există; altfel engleza.
- **Din admin** (`/admin/translations`): schimbi orice text în orice limbă, adaugi o limbă nouă
  (rămâne ascunsă până o activezi), descarci o limbă ca `.json` pentru un traducător și o încarci
  înapoi. Modificările apar în aplicație în cel mult un minut, fără deploy.
- **Cu fișiere**: o limbă nouă = un fișier nou, ex. `packages/i18n/src/locales/nl.json`, cu
  aceleași chei ca `en.json` (poți porni de la fișierul descărcat din admin). La build, fișierul
  intră automat în aplicație. Telefonul descarcă doar limba pe care o afișează (româna și engleza
  sunt incluse, celelalte se încarcă la alegere), deci limbile noi nu încetinesc aplicația.

Sintaxa: `{nume}` este o valoare înlocuită automat (ex. `"Plătește {amount}"`); textele cu număr
au câte o cheie pe formă de plural, după regulile limbii (`_one`, `_few`, `_other` în română;
`_one`, `_other` în engleză; `_one`, `_few`, `_many`, `_other` în rusă și ucraineană). Testele din
`packages/i18n` verifică la fiecare build că cele 9 limbi au toate textele, toate formele de plural
și aceleași valori `{...}`.

## Operatori, planuri și abonamente

Operatorii noi își deschid singuri contul la `/start` (sau prin invitația ta, cu link pe email),
primesc o perioadă de probă pe planul implicit și un ghid de pornire în 5 pași. Planurile
(abonament lunar + procent pe rezervare) se editează din `/admin/plans`. Implicit abonamentele se
facturează manual (`BILLING_PROVIDER=manual`); cu `BILLING_PROVIDER=stripe` operatorii plătesc cu
cardul prin Stripe Billing.

## Teste

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/affiliate_test pnpm test
```

Fără `TEST_DATABASE_URL`, testele care au nevoie de Postgres sunt sărite. Testele end-to-end
golesc baza de test la fiecare rulare, deci nu o folosi pentru altceva.

## Comenzi utile

| Comandă            | Ce face                                             |
| ------------------ | --------------------------------------------------- |
| `pnpm build`       | Compilează toate pachetele                          |
| `pnpm typecheck`   | Verifică tipurile                                   |
| `pnpm format`      | Formatează codul cu Prettier                        |
| `pnpm db:generate` | Generează o migrare nouă după o schimbare de schemă |
| `pnpm db:migrate`  | Aplică migrările pe baza din `apps/api/.env`        |

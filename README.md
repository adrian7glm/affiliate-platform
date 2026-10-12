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

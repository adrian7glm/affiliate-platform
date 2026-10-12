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

Login-ul se face cu cod unic (fără parolă). Local, codul apare în log-ul API-ului.
Plățile folosesc implicit un procesator de test (`PAYMENTS_PROVIDER=fake`): după checkout se
deschide o pagină locală de plată, fără cont Stripe. Pentru Stripe real, setează
`PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY` și `STRIPE_WEBHOOK_SECRET` în `apps/api/.env`.

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

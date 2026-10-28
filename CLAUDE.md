# Affiliate Platform — instrucțiuni pentru Claude

Acest fișier e memoria comună a proiectului: îl citesc atât sesiunile locale (PC-ul lui Adrian,
Laragon), cât și sesiunile din cloud (claude.ai/code). Ce se învață și merită păstrat se scrie
**aici**, în același commit/PR cu schimbarea, nu doar în memoria locală, pe care cloud-ul n-o vede.

@AGENTS.md

## Proiectul

SaaS de afiliere pentru operatori de turism (vezi `README.md`). Monorepo pnpm + Turborepo:
`apps/api` (NestJS, API + worker), `apps/web` (Next.js, PWA), `packages/*` (commission, contracts,
db cu Drizzle/Postgres, adapters, i18n). Structura și cine scrie în ce tabel: `docs/architecture.md`.
Endpoint-uri: `docs/api.md`. Deploy: `docs/deploy.md`.

## Comenzi

Node 22 (`.nvmrc`), pnpm 10.28.

```bash
pnpm install
pnpm build
pnpm db:migrate && pnpm db:seed
pnpm dev                 # API :4000, web :3000
pnpm test                # cere TEST_DATABASE_URL (baza affiliate_test)
```

CI (`.github/workflows/ci.yml`) rulează, în ordine: `format:check`, `lint`, `build`, `typecheck`,
`test`, plus build-ul imaginilor Docker. Rulează-le înainte de push; `pnpm format` repară formatarea
(Prettier verifică și fișierele `.md`).

## Reguli

- Un modul din `apps/api/src` scrie doar în tabelele lui (tabelul din `docs/architecture.md`).
- Schimbare de schemă = migrare nouă în `packages/db/migrations` (`pnpm db:generate`); nu edita
  migrările existente.
- Textele vizibile trec prin `packages/i18n`: cheia nouă se adaugă în **toate** cele 9 limbi
  (`src/locales/*.json`).
- Commit-uri în engleză, la imperativ, fără prefix (ex. „Fix late payments …”). Lucrul intră în
  `main` prin PR.
- Conturi demo (după seed, parola `demo1234`): `admin@demo.test`, `owner@demo.test`,
  `ana@demo.test`, `scanner@demo.test`.

## Rulare locală pe Windows (Laragon, fără Docker)

- PostgreSQL 16.10 portabil: `C:\laragon\bin\postgresql\postgresql-16.10`, date în
  `C:\laragon\data\postgresql`, user/parolă `postgres`/`postgres`, baze `affiliate` +
  `affiliate_test`.
- `start-local.cmd` (în rădăcină, neversionat) pornește Postgres, setează `DATABASE_URL`,
  `APP_SECRET`, `PLATFORM_ADMIN_EMAILS` și rulează `pnpm dev --env-mode=loose` (fără `loose`,
  Turborepo ascunde variabilele de API). `start-local.cmd setup` = migrare + seed.
- Nu există `apps/api/.env`: permisiunile lui Claude blochează citirea/scrierea `.env`, deci
  variabilele trec prin script.
- pnpm e instalat global (`npm i -g pnpm@10.28.0`); turbo nu găsește pnpm-ul din corepack.
- Ca să vezi un PR local: checkout pe branch, `pnpm install && pnpm build`,
  `start-local.cmd setup`, apoi `start-local.cmd`.

## Decizii

- 2026-10-28: memoria comună local ↔ cloud stă în acest `CLAUDE.md` versionat. Memoria automată
  locală (`~/.claude/projects/...`) rămâne doar pentru lucruri legate de PC.

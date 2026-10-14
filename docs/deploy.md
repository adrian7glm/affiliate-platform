# Lansare în producție

Platforma rulează ca 3 procese plus baza de date:

| Proces   | Imagine Docker (`Dockerfile`) | Ce face                                                                              |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `api`    | `--target api`                | API-ul HTTP. Pot rula oricâte, cu `WORKER_ENABLED=false`.                            |
| `worker` | `--target worker`             | Lucrul din fundal: evenimente, SMS/email, comisioane, sincronizări. **Unul singur.** |
| `web`    | `--target web`                | Aplicația web (Next.js). `NEXT_PUBLIC_API_URL` se dă la build.                       |
| Postgres | `postgres:16`                 | De preferat o bază administrată (backup și actualizări făcute de furnizor).          |

## Varianta cea mai simplă: un singur server

```bash
cp prod.env.example .env.prod        # completează parolele și cheile
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Pune în față un reverse proxy cu HTTPS (Caddy, Traefik sau cel al furnizorului): domeniul
principal către portul `3000` (web), subdomeniul `api.` către `4000`.

Pe platforme ca Railway, Render sau Fly.io creezi 3 servicii din același repo, cu `Dockerfile`
și target-ul de mai sus, plus o bază Postgres administrată.

## Ce se întâmplă la fiecare lansare

- **Migrările** se aplică automat la pornire (`MIGRATE_ON_START=true` în imagini). Mai multe
  procese care pornesc deodată se așteaptă unul pe altul (lock în Postgres), deci o migrare nu
  rulează de două ori.
- **Logurile** sunt JSON, câte un obiect pe linie (`LOG_FORMAT=json`), ușor de citit de orice
  colector de loguri.
- **Erorile neașteptate** (răspunsuri 500, joburi eșuate, evenimente oprite) ajung în Sentry dacă
  setezi `SENTRY_DSN`.

## Monitorizare

| Adresă               | Pentru                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| `GET /health`        | Load balancer: API-ul răspunde și ajunge la baza de date.                |
| `GET /health/worker` | Monitor de uptime (ex. UptimeRobot): `503` dacă workerul s-a oprit.      |
| `/admin/system`      | Starea fiecărui job și evenimentele interne oprite, cu buton de reluare. |

Când un eveniment intern (de exemplu „rezervare plătită → înregistrează comisionul”) eșuează de
10 ori, adminii platformei (`PLATFORM_ADMIN_EMAILS`) primesc un email. Încercările sunt tot mai
rare (5 s, 10 s, 20 s… până la o oră), deci o pană scurtă a sistemului unui operator nu le
consumă pe toate.

## Backup

- **Bază administrată:** activează backup-ul automat zilnic la furnizor (de obicei e inclus).
- **Pe serverul tău:** serviciul `backup` din `docker-compose.prod.yml` face zilnic un
  `pg_dump` în `./backups` și păstrează ultimele 14 zile (`docker/backup.sh`). Copiază folderul
  și în altă parte (alt server, S3), altfel un disc stricat ia și backup-urile.

Restaurare:

```bash
pg_restore --clean --no-owner -d "$DATABASE_URL" backups/affiliate-2026-10-13.dump
```

## Curățenie automată

Workerul șterge o dată la 6 ore ce nu mai e necesar: codurile de login mai vechi de o zi,
evenimentele interne procesate de peste 30 de zile, id-urile webhook-urilor Stripe de peste
90 de zile, SMS-urile și emailurile trimise de peste 180 de zile (conțin telefoane și emailuri)
și click-urile pe linkuri de peste 400 de zile (statisticile arată ultimele 13 luni). Rezervările,
biletele, plățile și comisioanele nu se șterg niciodată.

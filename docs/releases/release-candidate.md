# ManaWG Release Candidate Evidence

Status: BLOCKED — kein freigegebener Release-Kandidat  
Stand: 2026-09-19, Europe/Berlin  
Checkout: `/Users/abu/Company/manawg-app`  
Basis-SHA: `e34845a`  
Arbeitsbaum: uncommitted; dieser Nachweis ist kein Deployment- oder Produktionsfreigabeprotokoll.

## Lokal reproduziert

Mit Node 22.23.2 und pnpm 9:

- Frozen install: bestanden.
- Lint und Typecheck: bestanden.
- Production Build: bestanden.
- Bundle budget: 102.0 kB gzip / 120 kB shared budget.
- Analytics privacy und Feature-Boundaries: bestanden.
- OpenSpec strict: 12/12 bestanden.
- Release-workflow-gates: 7/7 bestanden.
- Fixture-E2E: zuletzt mit Exit 0 bestanden.
- Fokussierte Regressionen: Idempotenz 3/3, UX/Offline 5/5, Offline-Expense-Edit 1/1, Push-Validator 1/1, PWA-Plattform 1/1, JSON-Body-Reader 1/1, Account-Wechsel 1/1.
- `git diff --check`: bestanden.
- Production dependency audit: `pnpm audit --prod --audit-level high` ohne bekannte Schwachstellen.

## Öffentlicher Runtime-Probe

Am 2026-09-19 antwortete `https://app.manawg.com/api/health` mit HTTP 200 und
`{"status":"ok","database":"ok","degradedFeatures":["image-uploads"]}`.
Das belegt nur aktuelle Erreichbarkeit und Datenbankantwort; es ersetzt keine
Preview-/Auth-/Provider-/Rollback-Abnahme.

## Nicht freigegeben

Diese Claims fehlen weiterhin und dürfen nicht aus lokalen Fixture-/Source-Checks abgeleitet werden:

- Geschützte Preview-Datenbankmigration und `db:check` auf demselben SHA.
- Authentifizierter Preview-Browserlauf mit QA-Account, Cleanup und vertrauenswürdigem Vercel-Event.
- Direkter anonymer/authentifizierter RLS-Denial-Nachweis.
- Produktionsmigration, Backup/PITR, Restore-Drill, RPO/RTO, Monitoring, Support-Ownership und Rollback.
- Echte Provider-/Geräte-/Residenten-Nachweise für S3, Upstash, Push, PayPal, Kalender und PWA.
- Normaler Nicht-Fixture-Testlauf: lokale Supabase-Variablen fehlen und ein read-only `SELECT 1` gegen die vorhandene lokale DB-Konfiguration endet mit `ENOTFOUND`; der Lauf ist deshalb blockiert, nicht grün.

Aktueller GitHub-Statuscheck (Secret-Namen, keine Werte): vorhanden sind nur
E2E-Supabase-Basiswerte und der Vercel-Bypass. Es fehlen weiterhin das direkte
Preview-Migrationssecret, die SUPABASE_AUTH_TEST_*-Werte und der Production-
Migrationsnachweis. Die GitHub-Environments Preview und Production haben keine
Protection Rules bzw. Deployment-Branch-Policy.

## Release-Entscheidung

Nicht freigeben. Keine Migration, kein Deployment, kein Push und keine Produktionsdatenänderung wurden durch diesen Nachweis autorisiert.

## Nächster Nachweis

Preview-Secrets und QA-Account im geschützten Environment bereitstellen, anschließend den vollständigen gleich-SHA-Preview-Gate-Satz erneut ausführen. Werte gehören nicht in dieses Dokument.

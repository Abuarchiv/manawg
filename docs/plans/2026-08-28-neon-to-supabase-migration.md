# Ausführungsplan: manaWG von Neon/Vercel Postgres nach Supabase PostgreSQL

Stand: 28. August 2026  
Status: **Plan — noch nicht ausführen**  
Repository: `/Users/abu/Company/manawg`  
Zielgruppe: ausführendes Agentenmodell mit wenig Kontext  
Ziel: Datenbank-Hosting wechseln, ohne Datenverlust, Split-Brain oder zweite Migrationsquelle

## 1. Auftrag und feste Zielarchitektur

Die bestehende manaWG-Anwendung soll von Neon/Vercel Postgres nach Supabase PostgreSQL
umziehen. Supabase wird in diesem Vorhaben **nur als gemanagter PostgreSQL-Provider**
verwendet.

Diese Entscheidungen sind fest:

1. Drizzle bleibt die einzige Schema- und Migrationsquelle.
2. `apps/web/src/lib/db/schema.ts` bleibt das kanonische Schema.
3. `apps/web/drizzle/*.sql` bleibt die einzige aktive Migrationskette.
4. Die Anwendung bleibt auf Vercel.
5. Authentifizierung, Identität und Autorisierung bleiben unverändert.
6. Bilder bleiben auf AWS S3.
7. Es wird kein `@supabase/supabase-js` eingeführt.
8. Supabase Auth, Storage, Realtime, Edge Functions und Data API sind nicht Teil dieses
   Vorhabens.
9. Die Supabase Data API wird deaktiviert, weil das aktuelle `public`-Schema keine RLS-
   Policies besitzt und die App ausschließlich serverseitig per Drizzle zugreift.
10. Preview und Production erhalten zwei getrennte Supabase-Projekte.
11. Vercel Runtime-Verbindungen verwenden Supavisor Transaction Mode auf Port `6543`.
12. Migrationen, `pg_dump`, `pg_restore` und Administration verwenden Direct oder
    Supavisor Session Mode auf Port `5432`.
13. Der erste Migrationspfad ist ein getesteter Wartungsfenster-Dump/Restore.
14. Logical Replication wird nur nach dem in Phase 3 beschriebenen Stop-Gate neu geplant.

Nicht Teil dieses Plans:

- Umstellung auf Supabase Auth oder Supabase-Clientbibliotheken
- neue RLS-Policies als Produkt-Autorisierung
- Übernahme alter, gelöschter Supabase-/Nava-Migrationen aus der Git-Historie
- Umzug der S3-Bilder
- Schema-Redesign oder Datenmodell-Refactoring
- Abschaltung oder Löschung von Neon im selben Arbeitsschritt
- Push zu GitHub oder produktive Änderung ohne gesonderte Freigabe

## 2. Bekannter Ist-Zustand

Vor Ausführung erneut verifizieren; diese Angaben sind nur der Stand bei Planerstellung.

- Branch: `main`
- aktueller HEAD: `a2783e8`
- Datenbank: PostgreSQL auf Neon, bisher über Vercel Postgres
- ORM: Drizzle ORM
- aktives Schema: 24 Tabellen in `public`
- aktive Drizzle-Migrationen: `0000_baseline` bis `0004_friendly_texas_twister`
- Drizzle-Ledger: `drizzle.__drizzle_migrations`
- Standardzugriffe: Export `db` aus `apps/web/src/lib/db/index.ts`
- Multi-Statement-Schreibvorgänge: `withTransaction()` aus
  `apps/web/src/lib/db/transaction.ts`
- Vercel-Build: `node scripts/db-migrate.mjs && next build`
- Supabase CLI: `2.116.0`
- Supabase Login: gültig
- sichtbare Supabase-Organisation: derzeit `antritt-orders`; noch nicht als richtige
  Zielorganisation bestätigt
- Supabase-Projekte: derzeit keine über `supabase projects list` sichtbar
- lokales `supabase init`: ausgeführt; `supabase/config.toml` ist untracked
- Docker/Colima: nicht aktiv; für den gewählten nativen Dump/Restore-Pfad nicht nötig
- `psql`, `pg_dump`, `pg_restore`: derzeit nicht im `PATH`
- lokale Node-Version: derzeit `26.7.0`; für Repository-Arbeit Node 22 verwenden
- Worktree ist bereits fremd verändert:
  - `.gitignore` modifiziert
  - `.mcp.json` untracked
  - `supabase/` untracked

Die bestehenden fremden Änderungen niemals verwerfen, überschreiben oder gemeinsam mit
Migrationsänderungen stagen, sofern sie nicht ausdrücklich Teil eines freigegebenen Commits
werden.

## 3. Sicherheitsregeln für das ausführende Modell

Diese Regeln gelten in jeder Phase:

1. Immer nur **eine Phase pro Agentenkontext** ausführen.
2. Zu Beginn jeder Phase `git status --short` ausführen und das Ergebnis protokollieren.
3. Vor jedem externen Schreibvorgang den exakten Zielnamen, Projekt-Ref, Umgebung und Host
   erneut ausgeben — niemals den vollständigen Connection String.
4. Geheimnisse nie ausgeben, nie mit `env`, `printenv`, `set -x` oder `echo` anzeigen.
5. Connection Strings, Passwörter, Tokens, Dumps und `.pgpass` nie im Repository speichern.
6. Dumps ausschließlich in einem mit `mktemp -d` erzeugten Verzeichnis mit Modus `0700`
   ablegen.
7. Bei jedem als **STOP** markierten Zustand sofort aufhören und Befund melden.
8. Unbekannte Warnungen oder Fehler niemals als harmlos klassifizieren.
9. Production niemals als ersten Test verwenden.
10. Preview und Production niemals auf dasselbe Supabase-Projekt zeigen lassen.
11. Keine Schemaänderung parallel zur Migration zulassen.
12. Während des finalen Dumps keine Schreibzugriffe auf der Quelle zulassen.
13. Nach dem Öffnen von Schreibzugriffen auf Supabase nicht blind auf Neon zurückschalten.
14. Kein Push und keine Projektlöschung ohne neue, ausdrückliche Freigabe.

Verbotene Befehle und Verfahren:

```text
drizzle-kit push
supabase db push
supabase db reset --linked
supabase db reset --db-url ...
supabase migration repair
supabase projects delete
pg_restore --clean
pg_restore --create
pg_restore --disable-triggers
DROP SCHEMA public
DROP SCHEMA ... CASCADE
```

Zusätzlich verboten:

- Runtime-URL auf Port `6543` für Dump, Restore oder DDL verwenden
- `supabase_migrations.schema_migrations` als Drizzle-Ledger behandeln
- Neon-Rollen oder ACLs nach Supabase importieren
- Supabase-Systemschemas `auth`, `storage`, `extensions`, `realtime`, `vault` oder
  `supabase_*` überschreiben
- alte Supabase-Migrationen aus der Git-Historie wiederbeleben
- Restore-Fehler ignorieren
- `--jobs` und `--single-transaction` gemeinsam verwenden

## 4. Variablen und Begriffe

In Befehlen nur diese neutralen Variablennamen verwenden:

```bash
export MIGRATION_REPO=/Users/abu/Company/manawg

# Werden sicher aus Passwortmanager/Vercel/Provider geladen, nie ins Repo geschrieben:
export SOURCE_DIRECT_DB_URL='[REDACTED_SECRET]'
export PREVIEW_RUNTIME_DB_URL='[REDACTED_SECRET]'
export PREVIEW_MIGRATION_DB_URL='[REDACTED_SECRET]'
export PRODUCTION_RUNTIME_DB_URL='[REDACTED_SECRET]'
export PRODUCTION_MIGRATION_DB_URL='[REDACTED_SECRET]'

export SUPABASE_PREVIEW_REF='<20-character-project-ref>'
export SUPABASE_PRODUCTION_REF='<20-character-project-ref>'
```

Die Werte `[REDACTED_SECRET]` sind Platzhalter. Sie dürfen nicht wörtlich verwendet werden.
Das ausführende Modell darf die Werte nur auf Vorhandensein prüfen:

```bash
test -n "${SOURCE_DIRECT_DB_URL:-}" || exit 1
test -n "${PREVIEW_RUNTIME_DB_URL:-}" || exit 1
test -n "${PREVIEW_MIGRATION_DB_URL:-}" || exit 1
```

Es darf die Werte niemals ausgeben.

Verbindungszuordnung:

| Zweck | Preview | Production |
|---|---|---|
| Vercel Runtime | Transaction Pooler `:6543` | Transaction Pooler `:6543` |
| Drizzle-Migration | Direct/Session `:5432` | Direct/Session `:5432` |
| Dump/Restore/PSQL | Direct/Session `:5432` | Direct/Session `:5432` |

## 5. Phase 0 — Dokumentation und erlaubte APIs

### Ziel

Vor Änderungen bestätigen, dass keine veralteten oder erfundenen CLI-Optionen verwendet
werden.

### Verbindliche Primärquellen

1. Supabase PostgreSQL-Migration:
   <https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres>
2. Supabase Connection Modes:
   <https://supabase.com/docs/guides/database/connecting-to-postgres>
3. Supabase CLI Reference:
   <https://supabase.com/docs/reference/cli/getting-started>
4. Supabase Data API absichern/deaktivieren:
   <https://supabase.com/docs/guides/api/securing-your-api>
5. Drizzle mit PostgreSQL/node-postgres:
   <https://orm.drizzle.team/docs/get-started-postgresql>
6. PostgreSQL `pg_dump`:
   <https://www.postgresql.org/docs/current/app-pgdump.html>
7. PostgreSQL `pg_restore`:
   <https://www.postgresql.org/docs/current/app-pgrestore.html>

### Erlaubte Befehle

Read-only:

```text
supabase --version
supabase orgs list
supabase projects list
supabase ... --help
psql mit SELECT oder SHOW
pg_dump
pg_restore --list
git status
git diff
rg
pnpm test/typecheck/lint/build
```

Nur in der ausdrücklich freigegebenen Phase:

```text
supabase projects create
supabase link --project-ref <exact-ref>
pg_restore gegen ein leeres, exakt identifiziertes Preview-/Production-Ziel
Vercel-Environment-Änderungen
Vercel-Redeploy
ALTER DATABASE ... SET default_transaction_read_only
```

### Abnahme

- [ ] Alle verwendeten Flags stehen in einer der oben genannten Quellen oder in der lokal
      installierten `--help`-Ausgabe.
- [ ] Runtime `:6543` und Migration `:5432` sind im Plan getrennt.
- [ ] Drizzle und Supabase-Migrationsledger werden nicht vermischt.

### Anti-Pattern-Guard

Kein Befehl darf aus Erinnerung erfunden werden. Bei Abweichung zwischen Dokumentation und
lokaler CLI gilt die lokale `supabase ... --help`-Ausgabe für die installierte Version; die
Abweichung wird protokolliert.

## 6. Phase 1 — menschliche Entscheidungen und externe Freigaben

### Ziel

Alle Entscheidungen klären, die ein Agent nicht selbst treffen darf.

### Erforderliche Entscheidungen

Der Mensch bestätigt schriftlich:

- [ ] korrekte Supabase-Organisation; derzeit sichtbar ist `antritt-orders`
- [ ] Kosten-/Billing-Freigabe für zwei Supabase-Projekte
- [ ] Zielregion `eu-central-1` oder begründete Alternative
- [ ] Compute-Größe für Preview und Production
- [ ] Backup/PITR-Option für Production
- [ ] maximal erlaubtes Wartungsfenster in Minuten
- [ ] Termin des Cutovers außerhalb der Cron-Zeiten `06:10`, `08:00`, `09:00` UTC/Projektzeit
- [ ] Verantwortlicher Mensch für Go/No-Go beim Cutover
- [ ] Beobachtungsfenster, mindestens sieben Tage empfohlen

Projektaufteilung:

```text
manawg-preview     -> nur Vercel Preview/Test
manawg-production  -> nur Vercel Production
```

### STOP

Phase 1 ist blockiert, solange Organisation, Billing, Region, Compute oder Wartungsfenster
nicht bestätigt sind. Das ausführende Modell darf keine Projekte auf Verdacht anlegen.

### Dokumentationsreferenz

- Supabase CLI `projects create` und `projects list`
- Supabase Migrationsleitfaden, Abschnitt „Prepare Supabase project“

## 7. Phase 2 — lokale Toolchain reproduzierbar vorbereiten

### Ziel

Die lokale Umgebung auf die Repository- und PostgreSQL-Anforderungen bringen. Noch keine
Verbindung verändern und keine Daten kopieren.

### Schritte

1. Repository öffnen und Zustand sichern:

   ```bash
   cd /Users/abu/Company/manawg
   git status --short
   git branch --show-current
   git log -1 --oneline
   ```

   Erwartung: Branch `main`; bestehende fremde Änderungen werden nur protokolliert.

2. Node 22 aktivieren. Die Methode hängt vom installierten Versionsmanager ab. Danach:

   ```bash
   node --version
   pnpm --version
   ```

   Erwartung: `node --version` beginnt mit `v22.` und pnpm ist mindestens 9.

   **STOP**, wenn Node 22 nicht aktiv ist. Node 26 erzeugte in diesem Projekt bereits
   irreführende jsdom-Probleme.

3. Supabase CLI prüfen:

   ```bash
   supabase --version
   supabase orgs list --output-format json
   supabase projects list --output-format json
   ```

   Erwartung: CLI `2.116.0` oder neuer; Login funktioniert.

4. Native PostgreSQL-Clients installieren, wenn sie fehlen:

   ```bash
   brew install libpq
   export PG_BIN="$(brew --prefix libpq)/bin"
   "$PG_BIN/psql" --version
   "$PG_BIN/pg_dump" --version
   "$PG_BIN/pg_restore" --version
   ```

   Die Shell-Konfiguration nicht automatisch verändern. Für alle weiteren Befehle in diesem
   Runbook `$PG_BIN/...` verwenden.

5. Versionsregel:

   - `pg_dump` darf nicht älter als der Quellserver sein.
   - Ziel-PostgreSQL darf nicht älter als die Quelle sein, ohne separate Kompatibilitätsprüfung.
   - Quell- und Zielversion werden in Phase 3 live abgefragt.

### Verifikation

- [ ] Node 22 aktiv
- [ ] Supabase Login bestätigt
- [ ] `psql`, `pg_dump`, `pg_restore` ausführbar
- [ ] keine Datei im Repository verändert, außer bereits vorhandenen Benutzeränderungen

### Anti-Pattern-Guard

`supabase start` und Docker sind für diesen Plan nicht erforderlich. Nicht versuchen, den
Docker-Fehler zu reparieren, solange keine separate lokale-Supabase-Aufgabe freigegeben wird.

## 8. Phase 3 — Quelle inventarisieren und Migrationsmethode festlegen

### Ziel

Größe, Version, Extensions, Schema und Schreiblast messen. Erst danach Dump/Restore endgültig
bestätigen.

### Vorbereitung

`SOURCE_DIRECT_DB_URL` muss eine direkte Neon-Verbindung oder eine für native Tools geeignete
Session-Verbindung sein, nicht die Transaction-Pooler-URL der Anwendung.

```bash
test -n "${SOURCE_DIRECT_DB_URL:-}" || exit 1
export PG_BIN="$(brew --prefix libpq)/bin"
```

### Read-only-Inventur

```bash
"$PG_BIN/psql" "$SOURCE_DIRECT_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 <<'SQL'
select current_database(), current_user, version();
show server_version;
show default_transaction_read_only;
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select extname, extversion from pg_extension order by extname;
select count(*) as active_connections
from pg_stat_activity
where datname = current_database();
select count(*) as large_objects from pg_largeobject_metadata;
select schemaname, count(*) as table_count
from pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
group by schemaname
order by schemaname;
select schemaname, sequencename
from pg_sequences
where schemaname in ('public', 'drizzle')
order by schemaname, sequencename;
select id, hash, created_at
from drizzle.__drizzle_migrations
order by created_at, id;
SQL
```

Schema-Gesundheit:

```bash
"$PG_BIN/psql" "$SOURCE_DIRECT_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 <<'SQL'
select n.nspname, c.relname, con.conname
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'drizzle')
  and not con.convalidated;

select n.nspname, c.relname, i.relname as index_name
from pg_index x
join pg_class c on c.oid = x.indrelid
join pg_class i on i.oid = x.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'drizzle')
  and (not x.indisvalid or not x.indisready);
SQL
```

Erwartung nach heutigem Repository-Stand:

- 24 Anwendungstabellen in `public`
- keine unbekannten Large Objects
- keine unvalidierten Constraints
- keine ungültigen Indizes
- PostgreSQL-Features nur aus Standard-PostgreSQL: UUID, JSONB, generated stored columns,
  partielle Indizes, Check-Constraints, Foreign Keys und `timestamptz`

### Entscheidungsgate

Dump/Restore bleibt der Pfad, wenn alle Punkte erfüllt sind:

- [ ] gemessene DB-Größe ist kleiner als 10 GB
- [ ] keine inkompatible Extension
- [ ] keine Large Objects oder separat freigegebener Large-Object-Pfad
- [ ] Preview-Probe passt mit 50 Prozent Puffer ins Wartungsfenster
- [ ] Produktbetrieb akzeptiert einen vollständigen Schreibstopp

**STOP und neuen Logical-Replication-Plan erstellen**, wenn mindestens einer dieser Punkte
nicht erfüllt ist. Nicht während des Cutovers improvisieren.

### Dokumentationsreferenz

Supabase „Migrate from Postgres“, Methoden „Manual dump/restore“ und „Logical replication“.

## 9. Phase 4 — zwei Supabase-Zielprojekte anlegen und absichern

### Ziel

Zwei leere, eindeutig getrennte Zielprojekte bereitstellen. Noch keine manaWG-Daten laden.

### Externe menschliche Aktion

Projekte bevorzugt im Supabase Dashboard anlegen, damit Organisation, Region, Compute,
Passwort und Billing sichtbar bestätigt werden. Wenn die CLI verwendet wird, darf das
DB-Passwort nicht in Shell-History oder Logs erscheinen.

Nach Erstellung read-only prüfen:

```bash
supabase projects list --output-format json
```

Die beiden 20-stelligen Projekt-Refs sicher erfassen:

```text
SUPABASE_PREVIEW_REF     = <ref von manawg-preview>
SUPABASE_PRODUCTION_REF  = <ref von manawg-production>
```

**STOP**, wenn beide Refs gleich sind oder ein Projekt in der falschen Organisation/Region
liegt.

### CLI-Link

Das lokale Repository höchstens mit Preview verknüpfen:

```bash
cd /Users/abu/Company/manawg
supabase link --project-ref "$SUPABASE_PREVIEW_REF"
```

Danach:

```bash
supabase projects list --output-format json
test -f supabase/.temp/project-ref
```

Production nicht als Standardlink verwenden. Alle Production-Operationen verwenden später
explizite Connection Strings oder den expliziten Production-Ref.

### Data API zwingend deaktivieren

Für beide Projekte im Dashboard:

1. Integrations beziehungsweise Data API öffnen.
2. „Enable Data API“ ausschalten.
3. Einstellung speichern.
4. Keine Publishable-/Anon-/Service-Role-Schlüssel in Vercel eintragen.

Zusätzliche Least-Privilege-Härtung auf jedem Ziel vor dem Schemaaufbau:

```sql
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
```

### Connection Strings erfassen

Je Projekt aus „Connect“ kopieren:

- Runtime: Supavisor Transaction Pooler, Port `6543`
- Migration: Direct Port `5432`, falls vom ausführenden Host erreichbar; sonst Supavisor
  Session Pooler, Port `5432`

Jede URL separat mit read-only SQL verifizieren:

```bash
"$PG_BIN/psql" "$PREVIEW_MIGRATION_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 \
  -c 'select current_database(), current_user, version();'
```

Die Ausgabe muss im Usernamen oder über den zuvor geprüften Connection String eindeutig den
Preview-Ref enthalten. Dasselbe separat für Production.

### Abnahme

- [ ] zwei verschiedene Refs
- [ ] beide Projekte in bestätigter Organisation und Region
- [ ] Data API in beiden Projekten deaktiviert
- [ ] Default Grants widerrufen
- [ ] je Projekt Runtime- und Migration-URL getrennt
- [ ] keine URL im Repository oder Chatprotokoll gespeichert

## 10. Phase 5 — Anwendung provider-neutral vorbereiten

### Ziel

Die Anwendung zuerst auf dem bestehenden Neon stabil mit dem bereits installierten
`node-postgres`-Treiber betreiben. Danach ist der eigentliche Providerwechsel nur noch ein
kontrollierter Environment-Cutover.

### Grundsatz

Den bestehenden öffentlichen Vertrag nicht ändern:

- `db` bleibt der Standardclient.
- `withTransaction(fn)` bleibt der einzige Multi-Statement-Transaktionspfad.
- `DbTransaction` bleibt der Callertyp.
- `TransactionAbort` bleibt unverändert.
- Die rund 60 DB-Verbraucher werden nicht angepasst.

### Task 5.1 — Standardclient vereinheitlichen

Dateien:

- `apps/web/src/lib/db/index.ts`
- neue oder erweiterte Unit-Tests für diesen Client

Änderung:

1. Neon-HTTP-Imports entfernen.
2. Für jede PostgreSQL-URL den bereits installierten `pg.Pool` verwenden.
3. `drizzle-orm/node-postgres` verwenden.
4. Schema wie bisher übergeben.
5. Lazy-Initialisierung und Pool-Wiederverwendung erhalten.
6. Pool zunächst konservativ mit `max: 1` konfigurieren; erst nach Messdaten erhöhen.
7. `db.transaction` weiterhin aus dem öffentlichen Typ entfernen, damit Multi-Table-Writes
   nicht versehentlich den falschen Pfad verwenden.

Copy-ready Muster:

- vorhandener lokale `pg.Pool`-Zweig in `apps/web/src/lib/db/index.ts`
- offizielles Drizzle-node-postgres-Muster aus der Phase-0-Dokumentation

Tests müssen beweisen:

- Supabase-Transaction-Pooler-URL erzeugt `pg.Pool`, nicht Neon-Client.
- Pool erhält exakt den Connection String und `max: 1`.
- Pool/Drizzle werden pro Prozess nur einmal gebaut.
- Funktionsmethoden bleiben korrekt gebunden.

### Task 5.2 — Transaktionsclient vereinheitlichen

Dateien:

- `apps/web/src/lib/db/transaction.ts`
- `apps/web/src/lib/db/transaction.test.ts`

Änderung:

1. `NeonPool` und `drizzle-orm/neon-serverless` entfernen.
2. Für Neon, lokal und Supabase `pg.Pool` plus `drizzle-orm/node-postgres` verwenden.
3. `max: 1` setzen.
4. bestehenden `pool.on('error', ...)`-Handler behalten und provider-neutral benennen.
5. Singleton-Pool behalten.
6. Fehler niemals schlucken; Callback-Rejection muss weiterhin Rollback auslösen.

Testmatrix:

- lokale URL
- bestehende Neon-Pooler-URL
- Supabase-Transaction-Pooler-URL `:6543`
- Callback-Ergebnis wird zurückgegeben
- Callback-Fehler bleibt identisch
- `TransactionAbort` bleibt unterscheidbar
- Pool wird über drei Aufrufe nur einmal gebaut

Prepared Statements:

Supavisor Transaction Mode unterstützt keine Prepared Statements. In diesem Plan wird
`node-postgres` beibehalten; keine Query darf einen `name`-Wert für serverseitig vorbereitete
Statements erhalten. Der echte Preview-Supabase-Test in Phase 7 ist der verbindliche Beweis.
Nicht auf `postgres-js` wechseln und keine neue Abhängigkeit hinzufügen.

### Task 5.3 — Connection-Helfer bereinigen

Dateien:

- `apps/web/src/lib/db/connection.ts`
- `apps/web/src/lib/db/connection.test.ts`

Änderung:

1. `resolveConnectionString()` und Priorität `POSTGRES_URL` vor `DATABASE_URL` behalten.
2. Fehlermeldung provider-neutral formulieren.
3. `isLocalUrl()` entfernen, sobald kein Caller mehr existiert.
4. Tests für leere, fehlende und alternative URL behalten.
5. Mit `rg` beweisen, dass keine gelöschte API mehr importiert wird.

### Task 5.4 — DDL-URL explizit trennen

Dateien:

- `apps/web/scripts/db-migrate.mjs`
- passender Test für die URL-Auswahl
- `apps/web/drizzle.config.ts`
- `apps/web/.env.example`

Neue Variable:

```text
DATABASE_MIGRATION_URL
```

Vertrag:

1. Wenn `DATABASE_MIGRATION_URL` gesetzt ist, wird sie für DDL verwendet.
2. Für bestehende Neon-Deployments bleibt der aktuelle sichere Fallback erhalten:
   `POSTGRES_URL`/`DATABASE_URL` und Entfernung des Neon-`-pooler`-Labels.
3. Eine Supabase-Transaction-URL auf Port `6543` darf ohne
   `DATABASE_MIGRATION_URL` nicht still als DDL-URL verwendet werden; der Runner muss mit
   verständlicher Fehlermeldung abbrechen.
4. Lokales CI mit `POSTGRES_URL=postgres://...localhost...` bleibt funktionsfähig.
5. `drizzle.config.ts` darf für DB-nahe Befehle ebenfalls zuerst
   `DATABASE_MIGRATION_URL` lesen.

Tests der Resolverlogik:

- explizite Migrations-URL gewinnt
- Neon-Pooler-Fallback wird zum direkten Neon-Host
- lokale PostgreSQL-URL bleibt unverändert
- Supabase `:6543` ohne Migrations-URL wirft
- vollständig fehlende URL wirft

### Task 5.5 — migrationsweiter Schreibstopp

Dateien:

- `apps/web/src/middleware.ts`
- `apps/web/src/middleware.test.ts`
- `apps/web/.env.example`

Neue optionale Variable:

```text
MIGRATION_READ_ONLY=true
```

Verhalten:

1. Wenn nicht `true`, ändert sich nichts.
2. Wenn `true`, werden `POST`, `PUT`, `PATCH`, `DELETE` unter den gematchten API-Pfaden mit
   HTTP `503`, Fehlercode `migration_read_only` und `Retry-After` abgewiesen.
3. Alle `/api/cron/*`-Requests werden unabhängig von der HTTP-Methode blockiert, weil die drei
   Crons per `GET` Daten schreiben.
4. Lesende `GET`-Requests unter `/api/wg/*` bleiben verfügbar.
5. `/api/health` bleibt verfügbar.
6. Der Guard läuft vor Rate-Limit und vor DB-Arbeit.

Tests:

- POST `/api/wg` wird im Modus blockiert.
- PATCH/DELETE eines WG-Pfads wird blockiert.
- GET `/api/cron/recurring-advance` wird blockiert.
- GET `/api/wg/<code>` bleibt erlaubt.
- GET `/api/health` bleibt außerhalb des Guards.
- ohne Variable bleiben vorhandene Tests unverändert grün.

### Task 5.6 — Dependencies und Dokumentation

Dateien:

- `apps/web/package.json`
- `pnpm-lock.yaml`
- `README.md`
- `docs/code-architecture.md`
- `docs/business-plan.md`
- `apps/web/docs/bundle-budget.md`
- `supabase/config.toml` und `supabase/.gitignore` nur nach bewusster Entscheidung

Schritte:

1. Erst nach `rg`-Nachweis alle `@neondatabase/serverless`-Nutzungen entfernen.
2. Danach Dependency mit pnpm entfernen; Lockfile mechanisch aktualisieren.
3. Keine neue DB-Dependency hinzufügen; `pg` ist bereits vorhanden.
4. Dokumentation auf Supabase, zwei URLs und getrennte Preview-/Production-Projekte ändern.
5. `drizzle-kit push` weiterhin ausdrücklich verbieten.
6. Supabase Data API als deaktiviert dokumentieren.
7. Alte Supabase-Auth-/Storage-Architektur nicht zurückbringen.

### Lokale Verifikation von Phase 5

Mit Node 22:

```bash
cd /Users/abu/Company/manawg
pnpm install
pnpm check:deps
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Zusätzliche Greps:

```bash
rg -n '@neondatabase/serverless|neon-http|neon-serverless' apps/web package.json pnpm-lock.yaml
rg -n 'drizzle-kit push|supabase db push|supabase db reset' README.md docs apps/web
rg -n 'DATABASE_MIGRATION_URL|MIGRATION_READ_ONLY' apps/web README.md docs
```

Erwartung:

- erster Grep: keine aktive Code-/Dependency-Nutzung; historische erklärende Doku nur, wenn
  ausdrücklich als historisch markiert
- alle Repository-Gates grün
- keine Änderung an `schema.ts` oder bestehenden `drizzle/*.sql`

### Git-Disziplin

Vor Staging:

```bash
git status --short
git diff --check
```

Nur exakte Migrationsdateien stagen. Insbesondere nicht automatisch stagen:

```text
.gitignore
.mcp.json
```

Kein Push ohne ausdrückliche Freigabe.

## 11. Phase 6 — provider-neutralen Code zuerst gegen Neon beweisen

### Ziel

Vor Supabase muss der neue `pg`-Pfad auf der bestehenden Infrastruktur funktionieren. Damit
ist ein späterer Neon-Rollback technisch weiterhin möglich.

### Schritte

1. Vorbereitungsänderung zuerst in Vercel Preview mit bestehenden Neon-Variablen deployen.
2. Build-Log prüfen:
   - Migrationsrunner erfolgreich
   - `[migrate] Up to date.`
   - Next-Build erfolgreich
3. Preview `/api/health` prüfen.
4. In Preview mindestens diese Flows prüfen:
   - WG anlegen
   - WG beitreten
   - Ausgabe plus Splits anlegen
   - Ausgabe ändern
   - Import committen
   - Benachrichtigungseinstellungen ändern
   - wiederkehrenden Vorgang in isoliertem Test auslösen
5. Erst wenn Preview stabil ist, denselben Code auf Production-Neon deployen.
6. Production nur mit nicht-destruktiven Health-/Read-Smokes prüfen.

### STOP

- Neon-Health nicht 200
- Pool-/Connection-Timeouts
- Transaktionsfehler
- Migrationsrunner nicht no-op
- Vercel-Build rot

Bei Fehlern Code zurückrollen; noch keine Supabase-Datenmigration beginnen.

## 12. Phase 7 — Preview-Schema aufbauen und Datenmigration proben

### Ziel

Den vollständigen Ablauf auf `manawg-preview` messen und verifizieren. Diese Probe bestimmt,
ob der Production-Plan freigegeben werden darf.

### Task 7.1 — leeres Ziel prüfen

```bash
"$PG_BIN/psql" "$PREVIEW_MIGRATION_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 <<'SQL'
select count(*) as public_tables
from pg_tables
where schemaname = 'public';
select count(*) as drizzle_schema_exists
from information_schema.schemata
where schema_name = 'drizzle';
SQL
```

Erwartung: keine manaWG-Tabellen und kein Drizzle-Ledger.

**STOP**, wenn unbekannte Anwendungstabellen vorhanden sind. Nicht bereinigen, sondern neues
leeres Preview-Ziel verwenden oder menschliche Freigabe einholen.

### Task 7.2 — Schema ausschließlich per Drizzle aufbauen

```bash
cd /Users/abu/Company/manawg/apps/web
DATABASE_MIGRATION_URL="$PREVIEW_MIGRATION_DB_URL" \
POSTGRES_URL="$PREVIEW_RUNTIME_DB_URL" \
pnpm db:migrate
```

Das Kommando ein zweites Mal ausführen. Erwartung: `[migrate] Up to date.` und keine neue
Ledger-Zeile.

Prüfen:

```bash
"$PG_BIN/psql" "$PREVIEW_MIGRATION_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 <<'SQL'
select count(*) as public_tables
from pg_tables
where schemaname = 'public';
select id, hash, created_at
from drizzle.__drizzle_migrations
order by created_at, id;
SQL
```

Erwartung nach heutigem Stand: 24 Tabellen und die fünf aktuellen Migrationen. Vor Ausführung
immer `_journal.json` neu lesen; neuere legitime Migrationen ersetzen diese Momentaufnahme.

### Task 7.3 — geschütztes Arbeitsverzeichnis

```bash
umask 077
export MIGRATION_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
export MIGRATION_TMP="$(mktemp -d "${TMPDIR:-/tmp}/manawg-supabase-${MIGRATION_RUN_ID}.XXXXXX")"
chmod 700 "$MIGRATION_TMP"
```

Prüfen:

```bash
test -d "$MIGRATION_TMP"
test ! -e "$MIGRATION_REPO/$MIGRATION_RUN_ID"
```

### Task 7.4 — konsistenten Public-Data-Dump erzeugen

Für die Probe niedrige Last und atomaren Restore bevorzugen:

```bash
"$PG_BIN/pg_dump" \
  --dbname="$SOURCE_DIRECT_DB_URL" \
  --format=custom \
  --file="$MIGRATION_TMP/public-data.dump" \
  --data-only \
  --schema=public \
  --strict-names \
  --no-owner \
  --no-privileges \
  --no-subscriptions \
  --serializable-deferrable \
  --verbose \
  >"$MIGRATION_TMP/dump.log" 2>&1
```

Dump validieren:

```bash
test -s "$MIGRATION_TMP/public-data.dump"
"$PG_BIN/pg_restore" --list "$MIGRATION_TMP/public-data.dump" \
  >"$MIGRATION_TMP/public-data.list"
rg -n 'TABLE DATA|SEQUENCE SET' "$MIGRATION_TMP/public-data.list"
```

Verbotene Inhalte prüfen:

```bash
if rg -n ' auth | storage | extensions | realtime | vault | supabase_| drizzle ' \
  "$MIGRATION_TMP/public-data.list"; then
  exit 1
fi
```

### Task 7.5 — atomar in Preview wiederherstellen

```bash
"$PG_BIN/pg_restore" \
  --dbname="$PREVIEW_MIGRATION_DB_URL" \
  --format=custom \
  --data-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  --no-subscriptions \
  --single-transaction \
  --exit-on-error \
  --verbose \
  "$MIGRATION_TMP/public-data.dump" \
  >"$MIGRATION_TMP/restore.log" 2>&1
```

Jeder Non-zero-Exit ist **STOP**. Keine zweite Teilwiederherstellung auf dasselbe Ziel starten.

Danach:

```bash
"$PG_BIN/psql" "$PREVIEW_MIGRATION_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 \
  -c 'VACUUM (ANALYZE);'
```

### Task 7.6 — Data-API-Grants erneut prüfen

```bash
"$PG_BIN/psql" "$PREVIEW_MIGRATION_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 <<'SQL'
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke execute on all functions in schema public from anon, authenticated, service_role;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
order by grantee, table_name, privilege_type;
SQL
```

Erwartung: letzte Abfrage liefert null Zeilen. Data API bleibt im Dashboard deaktiviert.

### Task 7.7 — exakte Datenvalidierung

Auf Quelle und Ziel mit identischen Session-Einstellungen ausführen und Ausgaben getrennt
speichern:

```sql
set timezone = 'UTC';
set datestyle = 'ISO, YMD';
set bytea_output = 'hex';

select format(
  'select %L as table_name,
          count(*)::bigint as row_count,
          md5(coalesce(string_agg(row_md5, '''' order by row_md5), '''')) as content_md5
   from (
     select md5(to_jsonb(t)::text) as row_md5
     from %I.%I t
   ) rows',
  table_name,
  table_schema,
  table_name
)
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name
\gexec
```

Für jede der 24 Tabellen müssen `row_count` und `content_md5` identisch sein. Ein Unterschied
ist **STOP**.

Schema-Metadaten auf Quelle und Ziel vergleichen:

```sql
select c.relname, con.conname, con.contype, con.convalidated,
       pg_get_constraintdef(con.oid, true)
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by c.relname, con.conname;

select c.relname, i.relname, x.indisunique, x.indisvalid, x.indisready,
       pg_get_indexdef(i.oid)
from pg_index x
join pg_class c on c.oid = x.indrelid
join pg_class i on i.oid = x.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by c.relname, i.relname;
```

Alle Constraints validiert; alle Indizes valid und ready.

Fachliche Integritätsprüfungen:

```sql
-- Jede Ausgabe muss Splits besitzen und ihre Summe muss dem Ausgabenbetrag entsprechen.
select e.id
from expenses e
left join expense_splits s on s.expense_id = e.id
group by e.id, e.amount_cents
having count(s.id) = 0 or coalesce(sum(s.amount_cents), 0) <> e.amount_cents;

-- Offene Einkaufsnamen müssen innerhalb einer WG eindeutig sein.
select wg_id, normalized_name, count(*)
from shopping_items
where bought_at is null
group by wg_id, normalized_name
having count(*) > 1;

-- Keine ungültigen Reminder-Beträge/Kanäle.
select id
from expense_reminders
where amount_cents < 0 or channel not in ('push', 'inapp');
```

Erwartung: jede Abfrage null Zeilen.

### Task 7.8 — echte Supabase-App-Tests

Nur gegen Preview:

```bash
cd /Users/abu/Company/manawg
POSTGRES_URL="$PREVIEW_RUNTIME_DB_URL" \
DATABASE_MIGRATION_URL="$PREVIEW_MIGRATION_DB_URL" \
pnpm --filter @manawg/web test
```

Danach Preview-Deployment mit diesen URLs und `MIGRATION_READ_ONLY=false` testen.

Pflicht-Smokes:

- `/api/health` -> HTTP 200, `status=ok`, `database=ok`
- WG plus Ersteller in echter Transaktion
- Ausgabe plus Splits
- Idempotency-Race
- Import-Commit
- Export-Roundtrip
- Chat-Nachricht plus Reaktion/Read-Status
- Cron-Transaktion in kontrollierter Preview-Umgebung

### Task 7.9 — Zeitmessung und Go/No-Go

Dokumentieren:

```text
Dump-Dauer:
Restore-Dauer:
Validierungsdauer:
Gesamtdauer:
Gesamtdauer plus 50 % Puffer:
vereinbartes Wartungsfenster:
```

Production nur freigeben, wenn Gesamtdauer plus 50 Prozent Puffer in das Wartungsfenster
passt und alle Tests grün sind.

## 13. Phase 8 — Vercel Preview auf Supabase schalten

### Ziel

Die vollständige Anwendung mehrere Tage mit dem echten Supabase-Preview-Ziel betreiben.

### Vercel-Variablen für Preview

Im Vercel-Projekt `manawg`, Umgebung Preview:

```text
POSTGRES_URL             = PREVIEW_RUNTIME_DB_URL (:6543)
DATABASE_URL             = derselbe Preview-Runtime-Wert
DATABASE_MIGRATION_URL   = PREVIEW_MIGRATION_DB_URL (:5432)
MIGRATION_READ_ONLY      = false
```

Werte als sensitive Variablen setzen. Bestehende Produktionsvariablen nicht verändern.

Danach aktuellen Git-Commit als Preview neu deployen. Kein Deployment aus einem Dirty
Working Tree erzeugen.

### Verifikation

- [ ] Build nutzt Preview-Migrations-URL
- [ ] Migrationsrunner ist no-op
- [ ] Health 200
- [ ] Real-DB-Tests grün
- [ ] alle acht produktiven Transaktionspfade funktionieren
- [ ] keine Prepared-Statement-Fehler
- [ ] keine Connection-Time-outs oder Pool-Erschöpfung
- [ ] Data API bleibt deaktiviert
- [ ] Preview-Ref unterscheidet sich vom Production-Ref

Beobachtungszeit: mindestens 24 Stunden oder ein vollständiger realistischer Testzyklus.

## 14. Phase 9 — Production-Cutover vorbereiten

### Go/No-Go-Checkliste

- [ ] Phase 7 vollständig grün
- [ ] Phase 8 mindestens 24 Stunden stabil
- [ ] Wartungsfenster bestätigt
- [ ] Production-Supabase-Projekt leer und gehärtet
- [ ] Data API deaktiviert
- [ ] Production-Migrations-URL `:5432` verifiziert
- [ ] Production-Runtime-URL `:6543` verifiziert
- [ ] Neon-Backup/PITR oder zusätzlicher logischer Backup-Nachweis vorhanden
- [ ] keine parallele Schemaänderung/Deployment/Feature-Arbeit
- [ ] aktueller Git-Commit bekannt und grün
- [ ] Rollback-Verantwortlicher anwesend
- [ ] Cutover liegt nicht nahe der Cron-Zeiten

### Production-Ziel vorbereiten

1. Leeres Ziel prüfen.
2. Aktuelle Drizzle-Migrationen mit `PRODUCTION_MIGRATION_DB_URL` anwenden.
3. Zweiter Lauf muss no-op sein.
4. 24 Tabellen beziehungsweise aktueller Journalstand, null Anwendungszeilen.
5. Default Grants widerrufen.
6. Noch keine Production-Vercel-URL umstellen.

### Production-Environment vorbereiten

Die neuen Werte im Passwortmanager bereitstellen, aber erst im Cutover-Fenster aktivieren:

```text
POSTGRES_URL             -> PRODUCTION_RUNTIME_DB_URL :6543
DATABASE_URL             -> derselbe Production-Runtime-Wert
DATABASE_MIGRATION_URL   -> PRODUCTION_MIGRATION_DB_URL :5432
MIGRATION_READ_ONLY      -> true während Cutover
```

## 15. Phase 10 — Production-Cutover, Schritt für Schritt

Keinen Schritt überspringen. Nach jedem Gate Uhrzeit und Ergebnis notieren.

### Schritt 10.1 — Deployment-Freeze

1. Exakten freigegebenen Commit notieren.
2. Keine anderen Deployments zulassen.
3. `git status --short` prüfen.
4. Vercel Production weiterhin auf Neon belassen.

### Schritt 10.2 — Anwendung in Read-only-Modus bringen

1. In Vercel Production nur `MIGRATION_READ_ONLY=true` setzen.
2. Exakten aktuellen Production-Commit mit der neuen Variable redeployen.
3. Verifizieren:
   - GET einer bekannten WG funktioniert.
   - POST/PATCH/DELETE liefert 503 `migration_read_only`.
   - GET auf jeden Cron-Pfad liefert 503.
   - `/api/health` bleibt 200.
4. Mindestens die maximale Requestdauer abwarten.

**STOP**, wenn irgendein Schreibpfad noch erfolgreich schreibt.

### Schritt 10.3 — Quelle zusätzlich read-only setzen

Mit exakter Source-URL:

```bash
"$PG_BIN/psql" "$SOURCE_DIRECT_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 <<'SQL'
select format(
  'alter database %I set default_transaction_read_only = true;',
  current_database()
) \gexec
SQL
```

`ALTER DATABASE ... SET` ändert den Standard nur für **neu aufgebaute Verbindungen**.
Die eben verwendete Sitzung deshalb schließen und zwingend eine neue Verbindung öffnen:

```bash
"$PG_BIN/psql" "$SOURCE_DIRECT_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 \
  -c 'show default_transaction_read_only;'
```

Erwartung: `on`.

### Schritt 10.4 — finale Quell-Fingerprints erstellen

Vor dem Dump exakte Row Counts und Content-MD5 je Tabelle erzeugen und sicher außerhalb des
Repos speichern. Dieselbe SQL aus Task 7.7 verwenden.

Zusätzlich:

```sql
select sum(n_tup_ins) as inserted,
       sum(n_tup_upd) as updated,
       sum(n_tup_del) as deleted
from pg_stat_user_tables;
```

Nach mehr als der maximalen Requestdauer erneut ausführen. Werte dürfen sich nicht ändern.

### Schritt 10.5 — finalen Dump erstellen

Neues `mktemp`-Verzeichnis erzeugen; keinen Preview-Dump wiederverwenden.

Dasselbe verifizierte `pg_dump`-Kommando aus Task 7.4 verwenden. Dump-Exitcode muss null sein.
TOC mit `pg_restore --list` prüfen. Verbotene Schemas dürfen nicht enthalten sein.

### Schritt 10.6 — Production-Ziel erneut als leer bestätigen

```sql
select format('%I.%I', schemaname, tablename) as table_name,
       n_live_tup
from pg_stat_user_tables
where schemaname = 'public'
order by table_name;
```

Für jede Anwendungstabelle muss der exakte `count(*)` null sein. Statistische
`n_live_tup`-Werte allein sind kein Beweis.

### Schritt 10.7 — atomarer Restore

Dasselbe `pg_restore`-Kommando aus Task 7.5 verwenden, aber mit
`PRODUCTION_MIGRATION_DB_URL`.

Pflichtflags:

```text
--data-only
--schema=public
--single-transaction
--exit-on-error
--no-owner
--no-privileges
```

Jeder Fehler ist **STOP**. Production bleibt im Wartungsmodus und weiterhin auf Neon.

### Schritt 10.8 — Ziel validieren

In dieser Reihenfolge:

1. `VACUUM (ANALYZE)`
2. Data-API-Grants widerrufen und Null-Ergebnis prüfen
3. exakte Row Counts je Tabelle vergleichen
4. Content-MD5 je Tabelle vergleichen
5. Constraints vergleichen und validiert prüfen
6. Indizes vergleichen und valid/ready prüfen
7. fachliche Integritätsqueries prüfen
8. Drizzle-Ledger prüfen
9. Migrationsrunner zweimal ausführen; beide Läufe no-op

Keine ungeklärte Abweichung akzeptieren.

### Schritt 10.9 — Vercel Production auf Supabase umstellen, Writes weiter gesperrt

In Vercel Production setzen:

```text
POSTGRES_URL             = PRODUCTION_RUNTIME_DB_URL
DATABASE_URL             = derselbe PRODUCTION_RUNTIME_DB_URL
DATABASE_MIGRATION_URL   = PRODUCTION_MIGRATION_DB_URL
MIGRATION_READ_ONLY      = true
```

Aktuellen freigegebenen Commit redeployen.

Prüfen:

- Build-Migration no-op
- Build grün
- `/api/health` 200
- bekannte WG lesbar
- Dashboards, Ausgaben, Einkaufen, Pinnwand, Putzen, Kalender, Inventar und Chat lesbar
- Mutationen weiterhin 503
- Crons weiterhin 503

Dieser Punkt ist die letzte einfache Rückfallmöglichkeit ohne Daten-Divergenz.

### Schritt 10.10 — menschliches Go für Schreiböffnung

Der verantwortliche Mensch prüft die Ergebnisse und gibt ausdrücklich „Writes öffnen“ frei.
Ohne diese Nachricht nicht fortfahren.

### Schritt 10.11 — Writes auf Supabase öffnen

1. In Vercel Production `MIGRATION_READ_ONLY=false` setzen oder Variable entfernen.
2. Aktuellen Commit erneut deployen.
3. Zeitpunkt als `T_open` notieren.
4. Neon bleibt read-only.

### Schritt 10.12 — kontrollierte Write-Smokes

Mit einem ausdrücklich als Test gekennzeichneten Datensatz:

1. Test-WG anlegen.
2. zweiten Test-Member hinzufügen.
3. Ausgabe mit mindestens zwei Splits anlegen.
4. Ausgabe ändern.
5. Einkaufsartikel anlegen und abhaken.
6. Pinnwand-Eintrag plus Reaktion anlegen.
7. Chat-Nachricht plus Reaktion anlegen.
8. Import mit kleinem Testdatensatz prüfen.
9. Test-WG über den vorgesehenen Produktpfad löschen.

Danach Health und Logs prüfen. Keine direkten SQL-Löschungen für den Test verwenden.

## 16. Phase 11 — Rollback-Vertrag

### Vor `T_open`

Solange Supabase keine Production-Writes akzeptiert hat:

1. Vercel weiter im Wartungsmodus halten.
2. Vercel-DB-URLs zurück auf Neon setzen.
3. freigegebenen Commit redeployen.
4. Health und Reads prüfen.
5. Erst danach Neon wieder beschreibbar machen:

   ```bash
   "$PG_BIN/psql" "$SOURCE_DIRECT_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 <<'SQL'
   select format(
     'alter database %I set default_transaction_read_only = false;',
     current_database()
   ) \gexec
   SQL
   ```

6. `MIGRATION_READ_ONLY=false` setzen und redeployen.

Das ist der einfache Rollback.

### Nach `T_open`

Nach dem ersten möglichen Supabase-Write ist Neon veraltet. Dann gilt:

1. Sofort wieder `MIGRATION_READ_ONLY=true` aktivieren und deployen.
2. Supabase und Neon beide eingefroren lassen.
3. Content-Fingerprints gegen den Stand bei `T_open` vergleichen.
4. Wenn irgendeine Supabase-Tabelle abweicht, liegt Daten-Divergenz vor.
5. Nicht blind auf Neon zurückschalten.
6. Bevorzugt auf Supabase vorwärts reparieren.
7. Falls Rückkehr zwingend ist, separaten Reconciliation-Plan Supabase -> neue Neon-Branch
   erstellen, vollständig testen und menschlich freigeben.

**Es gibt nach `T_open` keinen simplen Environment-Rollback.**

## 17. Phase 12 — Beobachtungsfenster und spätere Bereinigung

### Erste 24 Stunden

Überwachen:

- `/api/health`
- Vercel Function Errors
- Connection Time-outs
- Supabase Database/Pooler Connections
- Transaktionsfehler
- Cron-Ausführungen
- Idempotency-Konflikte
- Latenz kritischer WG-Routen

Mindestens nach 1, 6 und 24 Stunden:

- Health prüfen
- Row Counts für zentrale Tabellen erfassen
- fachliche Integritätsqueries ausführen
- Data API weiterhin deaktiviert bestätigen

### Sieben Tage

Neon read-only und unverändert behalten. Nicht löschen und keine Credentials entfernen, solange
das Beobachtungsfenster läuft.

### Nach Beobachtungsfenster — separate Freigabe erforderlich

Mögliche Bereinigung, nicht automatisch ausführen:

1. alte Neon-Vercel-Integration und ungenutzte Neon-Systemvariablen entfernen
2. `DATABASE_URL`-Alias entfernen, falls nur `POSTGRES_URL` gewünscht ist
3. Neon-Projekt archivieren oder löschen
4. Backup-/PITR-Retention für Supabase finalisieren
5. Poolgröße anhand Messdaten anpassen; `max: 1` nur bei belegtem Engpass erhöhen
6. irreführende historische Supabase-Dokumente separat aktualisieren

Jede Löschung ist ein eigener, ausdrücklich freizugebender Vorgang.

## 18. Finale Abnahmekriterien

Die Migration ist erst abgeschlossen, wenn alle Punkte wahr sind:

- [ ] Production und Preview nutzen unterschiedliche Supabase-Projekt-Refs
- [ ] Supabase Data API ist für beide Projekte deaktiviert
- [ ] keine Data-API-Rolle besitzt Rechte auf manaWG-Tabellen
- [ ] Drizzle ist die einzige aktive Migrationsquelle
- [ ] keine Supabase-Migrationskette unter `supabase/migrations/` eingeführt
- [ ] 24 beziehungsweise aktuell erwartete Tabellen vorhanden
- [ ] exakte Row Counts Quelle/Ziel stimmen für jede Tabelle
- [ ] Content-MD5 Quelle/Ziel stimmt für jede Tabelle
- [ ] Constraints vollständig und validiert
- [ ] Indizes vollständig, valid und ready
- [ ] fachliche Integritätsqueries liefern null Fehlerzeilen
- [ ] Drizzle-Migrationsrunner ist auf Supabase idempotent/no-op
- [ ] Runtime verwendet Transaction Pooler `:6543`
- [ ] Migrationen verwenden Direct/Session `:5432`
- [ ] alle Repository-Gates mit Node 22 grün
- [ ] Preview-Test mindestens 24 Stunden stabil
- [ ] Production Health 200
- [ ] alle kritischen Transaktionspfade funktionieren
- [ ] Cron-Schreibpfade funktionieren nach Wiederöffnung
- [ ] kein Secret und kein Dump im Repository
- [ ] Neon bleibt für das vereinbarte Rollback-Fenster read-only erhalten
- [ ] Cutover-Protokoll enthält `T_open`, Prüfwerte und Go/No-Go-Entscheidung

## 19. Übergabeformat zwischen kleinen Agenten

Am Ende jeder Phase muss der ausführende Agent genau dieses Schema ausfüllen:

```text
Phase:
Status: COMPLETE | STOPPED
Git HEAD:
Git status --short:
Ausgeführte Befehle ohne Secretwerte:
Geänderte Dateien:
Externe Änderungen:
Verifikationen und Ergebnisse:
Stop-Gates geprüft:
Offene Risiken:
Nächste erlaubte Phase:
Menschliche Freigabe erforderlich: ja/nein, wofür genau:
```

Eine neue Sitzung darf nur mit diesem Übergabeblock und dem vorliegenden Plan fortsetzen.

## 20. Zusammenfassung für den Ausführer

Der kleinste sichere Weg ist:

1. zwei Supabase-Projekte anlegen und Data API deaktivieren;
2. vorhandenen `pg`-Treiber provider-neutral machen und erst auf Neon beweisen;
3. getrennte Runtime-/Migrations-URLs einführen;
4. Supabase-Zielschema mit der vorhandenen Drizzle-Kette erzeugen;
5. nur `public`-Daten atomar dumpen/restoren;
6. Preview vollständig proben und messen;
7. Production-Writes sperren, final dumpen, exakt validieren;
8. Vercel erst read-only auf Supabase schalten;
9. Writes erst nach menschlichem Go öffnen;
10. Neon mindestens sieben Tage read-only behalten.

Wenn ein Schritt davon nicht beweisbar grün ist, ist die richtige Aktion **STOP**, nicht
Improvisation.

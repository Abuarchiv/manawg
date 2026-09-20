# ManaWG Release Readiness

Stand: 2026-09-20, Europe/Berlin
Scope: `/Users/abu/Company/manawg-app`
HEAD: `cae9b0bf3f5e6e4a032933acc82fd7a99a301b96` (`main`)
Arbeitsbaum: dirty; kein Release-Candidate-SHA eingefroren.

Statuswerte: `offen` · `in Arbeit` · `erledigt` · `blockiert`

## Definition of Done

- Jede Aufgabe ist erledigt oder mit Owner, Entscheidung und aktuellem Nachweis blockiert dokumentiert.
- Lokale Gates beziehen sich auf denselben geprüften Arbeitsstand.
- Kernflüsse haben sichtbare Erfolgs-, Fehler-, Offline- und Recovery-Zustände.
- Preview/Auth/RLS, Provider, Geräte, Recovery und Produktion sind nur mit echtem Nachweis geschlossen.

## Priorisierte Aufgaben

### T1 — Bestandsaufnahme und Scope

Status: erledigt

Abnahme: Checkout, Branch/Dirty-State, Projektregeln, Scripts, OpenSpec, Playwright-Konfiguration, TODO-/Placeholder-Signale und Release-Dokumente geprüft. Node 22 und pnpm 9 sind der Projektvertrag.

### T2 — Aufgabenboard und 30-Minuten-Kontrolllauf

Status: in Arbeit

Abnahme: genau ein aktiver Job, keine Doppelstarts, read-only Prüfung und kein Dateischreibzugriff.

- [x] Job `manawg-release-control-2026-09-19` aktiv: `8f73b5b4-543a-4a98-864c-253f24558265`.
- [x] `*/30 * * * *`, Europe/Berlin, isoliert, Astra High, keine Zustellung.
- [x] Payload am 2026-09-20 auf read-only umgestellt; keine Python-/Shell-Append-Skripte mehr.
- [ ] Nach T9 deaktivieren.

### T3 — Lokale Qualitäts- und Reproduzierbarkeitsgates

Status: erledigt

Abnahme: lokale Gates wurden nach dem aktuellen HEAD `cae9b0b` und den dirty Änderungen erneut ausgeführt.

- [x] Historischer Lauf: Typecheck, Lint, Build, Bundle, Analytics, OpenSpec 5/5, Fixture-E2E 80/24/0, Chat 2/2, Workflow-Gates 9/9, Audit ohne High-Schwachstellen.
- [x] Finaler Readback: Typecheck, Lint, Build, Bundle, Analytics, OpenSpec 5/5, Release-Workflow-Gates 9/9 und Fixture-E2E Exit 0.

### T4 — Backend, Auth und Datenintegrität

Status: blockiert

Abnahme: Auth, WG-Mitgliedschaft, Idempotenz, JSON-Limits, Offline-Reconciliation, Inventory-Consume, Settlement und Benachrichtigungen sind fail-closed, retry-sicher und gegen echte Preview-DB/Auth belegt.

- [x] Fixture-Auth, Settlement-Cache, Idempotenz-, Push-, JSON-Body-, Inventory- und Member-Regressionen lokal grün.
- [x] Fire-and-forget-Fehler beim Auszug und PayPal-Profil werden sichtbar behandelt.
- [x] Chat-Lesestatus bleibt bei Fehlern sichtbar und retrybar.
- [ ] Cross-WG-/Parent-Kombinationen mit authentifizierten Preview-Nutzern.
- [ ] Revoked-membership und Zwei-Nutzer-Privacy im Preview.

Blocker: QA-Account/Secrets fehlen im Preview-Environment; die Vercel-CLI-Deployment-Prüfung funktioniert, die API-Route ist aber SSO-geschützt.

### T5 — UX, Accessibility und Kernflüsse

Status: blockiert

Abnahme: initial, leer, loading, success, failure, offline und recovery bei 320/390px, Light/Dark, Tastatur und reduzierter Bewegung plus Residenten-Usability.

- [x] Lokale UI-/Offline-/PWA-/Account-Wechsel-Regressionen und frühere Browserreviews dokumentiert.
- [x] Fixture-Suite deckt Fehler-, Retry-, Offline- und Recovery-Pfade ab.
- [ ] Fünf Residenten testen den Candidate-SHA.
- [ ] Echter Safari/iOS-/Android-Gerätenachweis.

### T6 — Geschützte Preview-Abnahme: Migration, Auth und Privacy

Status: blockiert

Abnahme: gleicher Candidate-SHA, Preview-Migration/db:check, Vercel-Event, QA-Auth, RLS-Denial, revoked membership, Zwei-Nutzer-Privacy und Cleanup.

- [x] Preview-Projekt `sthiwjebcwwiphashgla` reaktiviert; Status `ACTIVE_HEALTHY`.
- [x] Repo-Migrationen `0010_enable_public_rls.sql`, `0011_explicit_member_roles.sql` und `0012_pale_drax.sql` nach ACTIVE-Readback angewendet.
- [x] Preview-Katalog: 26 Tabellen, `disabled_count=0`; `anon` und `authenticated` erhalten auf `public.wgs` erwartungsgemäß `permission denied`.
- [x] Keine Preview-Policies/Grants ergänzt; das entspricht dem server-owned Access-Modell.
- [x] Supabase CLI `db query --linked`: `rls_disabled=0`; `anon`-Abfrage wird mit `permission denied` abgewiesen.
- [x] Vercel CLI `curl /api/health`: `status=ok`, `database=ok`, `missingRequiredCount=0`.
- [x] Exaktes `db:check` am 2026-09-20 16:40 CEST bestanden: autorisierte direkte CLI-Verbindung, Rolle wie CLI-Dump, TLS verify-full mit Supabase-CA; 13 kanonische Ledger-Einträge.
- [x] Fehlende Ledger-Einträge 0010–0012 nach bytegenauem Vergleich mit bereits angewendeter Supabase-Historie ergänzt; Rollback vorher bewiesen. Keine Schema-/App-Datenänderung.
- [x] Sechs echte Hosted-Auth-/Guest-/Reset-Checks bestanden; synthetischer Account und isolierte Test-WG jeweils entfernt.
- [x] Zentraler Runtime-Fix: App-Transaktionen ignorieren Migrations-Credentials; sechs Resolver-/Ledger-Regressionen und echter Preview-Schreib-/Rollback-Test in derselben DB-Sitzung bestanden.
- [ ] Fix auf neuem Preview-Candidate mit vorhandenen serverseitigen Secrets ausrollen und Mitgliedschafts-409 erneut im Hosted-Browser beweisen. Korrektur 17:05 CEST: env pull liefert Redaktionsmarker für sensible Werte; daraus folgt kein fehlender oder ungültiger Vercel-Zugang.
- [ ] Authentifizierter Browserlauf, revoked membership, Privacy und Cleanup.

### T7 — Externe Provider und Geräte

Status: blockiert

Abnahme: S3, Rate-Limit, Push, Kalender, PayPal, Import/Export, PWA sowie iOS-/Android-Pfade mit sicheren Testdaten.

Blocker: Providerzugänge, QA-Testdaten und echte Geräteprüfungen fehlen.

### T8 — Recovery, Monitoring und Produktionsbetrieb

Status: blockiert

Abnahme: Backup/PITR, RPO/RTO, Restore-Drill, Monitoring/Alerting, Support-Ownership, Rollback und kontrollierte Produktionsfreigabe für denselben SHA.

- [x] Recovery-Runbook und Stop-Bedingungen dokumentiert.
- [ ] Provider-Backup/PITR, isolierter Restore-Drill, RPO/RTO und Monitoring.
- [ ] Production-RLS-Migration, Deployment und Rollback nach Preview-Freigabe.

### T9 — Abschluss und Release-Entscheidung

Status: blockiert

Abnahme: T2–T8 aktuell belegt, Candidate-SHA eingefroren, alle P0/P1-Gates erledigt oder begründet blockiert.

Blocker: neuer Candidate mit dauerhafter Preview-Konfiguration, T4/T5 QA, vollständige T6-Mitgliedschaft/Privacy, T7 und T8. Lokaler T3-Readback und Testdaten-Cleanup sind belegt.

## Externer Live-Readback — 2026-09-20

- Preview `sthiwjebcwwiphashgla`: `ACTIVE_HEALTHY`; 26 öffentliche App-Tabellen mit RLS aktiv; direkte Rollenabfrage als `anon` und `authenticated` auf `public.wgs` wird abgewiesen.
- Preview-Migrationsreadback 16:40 CEST: Drizzle-Ledger enthält jetzt das kanonische Präfix `0000`–`0012`; die drei Ergänzungen sind durch bytegleiche Supabase-Ausführungshistorie belegt. Exaktes `db:check` bestanden.
- Preview Security Advisor: RLS-ohne-Policy als INFO für 26 Tabellen (beabsichtigtes server-owned Modell) und `auth_leaked_password_protection` als WARN.
- Production `bwsvsvfgbrsonepffqff`: `ACTIVE_HEALTHY`, aber die 26 App-Tabellen hatten im letzten direkten Readback `RLS=false`; Production wurde nicht verändert.
- Vercel CLI: neuer Preview-Deploy `https://manawg-qhpaco526-abditubes-projects.vercel.app` aus clean `main`-HEAD, `Ready`; `vercel curl /api/health` meldet Datenbank `ok`.
- GitHub CI: letzter Preview-Lauf scheiterte am Source-SHA-Mismatch nach dem Merge; Main-Lauf scheiterte an der geschützten direkten Preview-DB-URL.
- GitHub-Repo-Secrets vorhanden: E2E-URL/Key/E-Mail/Passwort und Vercel-Bypass. Fehlend für den Workflow: `SUPABASE_PREVIEW_DATABASE_MIGRATION_URL` und `SUPABASE_AUTH_TEST_*`.
- Keine Production-Migration, kein Push und kein Deployment ausgeführt. Preview-Migrationen wurden ausschließlich im Preview-Projekt angewendet.

## Nächste autorisierte Aktion

Candidate-SHA einfrieren und nativen Preview-Deploy mit den bestehenden Vercel-Secrets prüfen. Danach Mitgliedschafts-409, revoked membership, Zwei-Nutzer-Privacy sowie Provider-/Geräte-/Recovery-Gates schließen. Keine Credential-Rotation auf Grundlage redigierter env-pull-Werte.

## Kontrolllauf

- Zeitpunkt: 2026-09-20 16:54 CEST; direkter Ausbauauftrag ersetzt den Lock-Kontrolllauf.
- Statuszähler: lokale Fixture-Suite 85 bestanden, 25 übersprungen, 0 Fehler; sechs Hosted-Checks bestanden.
- Ergebnis: Build/Lint/Typecheck grün; DB-Ledger repariert, db:check und echter Transaktions-Rollback bestanden; Testdaten-Cleanup bestätigt.
- Nächster Schritt: dauerhafte Preview-Konfiguration herstellen und Runtime-Fix auf einem neuen Candidate end-to-end prüfen.

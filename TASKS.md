# ManaWG Release Readiness

Stand: 2026-09-19, Europe/Berlin  
Scope: `/Users/abu/Company/manawg-app`  
Current commit: `7bb5a091bcc26f966c12f5cc4f489455aaa943bc` (`main`)
Working tree: one uncommitted release-evidence edit; no release SHA is frozen.

Statuswerte: `offen` · `in Arbeit` · `erledigt` · `blockiert`

## Definition of Done

- Jede Aufgabe ist `erledigt` oder extern mit Owner, Entscheidung und Nachweis
  als `blockiert` dokumentiert; blockierte P0/P1-Gates verhindern Release.
- Alle lokalen Gates beziehen sich auf denselben eingefrorenen Candidate-SHA.
- Alle sichtbaren Kernflüsse haben geprüfte Erfolgs-, Fehler-, Offline- und
  Recovery-Zustände; keine Platzhalter oder unbelegten Release-Claims bleiben.
- Preview/Auth/RLS, Provider, Geräte, Recovery und Produktion sind nur mit
  echtem Nachweis abgeschlossen; lokale Fixture-Tests ersetzen sie nicht.

## Priorisierte Aufgaben

### T1 — Bestandsaufnahme und Scope

Status: erledigt

Abnahme: Checkout, Branch/Dirty-State, Projektregeln, Scripts, OpenSpec,
Playwright-Konfiguration, TODO-/Placeholder-Signale und Release-Dokumente sind
geprüft; historische Berichte sind nur Kontext.

Nachweis: `/Users/abu/Company/manawg-app`, `main`, bestehende uncommitted
Änderungen bewahrt, Node 22/pnpm 9 als Projektvertrag, OpenSpec `5/5` validiert.

### T2 — Aufgabenboard und 30-Minuten-Kontrolllauf

Status: in Arbeit

Abnahme: Diese Datei ist die einzige Release-Liste. Genau ein Kontrolllauf darf
gleichzeitig laufen, prüft `TASKS.md`, Teststatus und Abnahmekriterien, schreibt
einen kurzen Statusblock und setzt bei offenen Punkten die Arbeit fort.

- [x] Bestehende Automationen read-only inventarisiert; kein ManaWG-Job war
  vorhanden, bestehende Heartbeat-/Memory-/Nami-/Luffy-Jobs bleiben unverändert.
- [x] Einen idempotenten 30-Minuten-Job mit Repo-Scope registriert:
  `manawg-release-control-2026-09-19` / Job-ID
  `8f73b5b4-543a-4a98-864c-253f24558265`, `*/30 * * * *`, Europe/Berlin,
  isolated, Astra High, keine Chat-Zustellung.
- [ ] Einen echten ersten Lauf ohne Doppelstart und ohne TASKS-Korruption
  nachweisen.
- [ ] Den Job erst nach T9 pausieren.

### T3 — Lokale Qualitäts- und Reproduzierbarkeitsgates

Status: in Arbeit

Abnahme: Node 22/pnpm 9 bestehen Install, Lint, Typecheck, Build, Bundle,
Analytics, Feature-Boundaries, Fixture-E2E, fokussierte Regressionen, OpenSpec,
Release-Workflow-Gates und Whitespace.

- [x] Lint, Typecheck, Analytics und OpenSpec `5/5` bestanden.
- [x] Frischer Production-Build und Bundle-Budget bestanden.
- [x] Fixture-E2E nach Auth-/Cache-Regression-Fix mit Exit 0 bestanden.
- [x] Fokussierte Regressionen und `release-workflow-gates` mit Exit 0 bestanden.
- [x] `git diff --check` bestanden.
- [ ] Normaler Nicht-Fixture-Testlauf gegen echte DB/Auth-Konfiguration
  ausführen oder als extern blockiert mit aktuellem Fehler belegen.
- [x] Production dependency audit: `pnpm audit --prod --audit-level high` ohne
  bekannte Schwachstellen.

### T4 — Backend, Auth und Datenintegrität

Status: in Arbeit

Abnahme: Authentifizierung, WG-Mitgliedschaft, Idempotenz, JSON-Limits,
Offline-Reconciliation, Inventory-Consume, Settlement und Benachrichtigungen
sind fail-closed, retry-sicher und mit fokussierten Regressionen belegt.

- [x] Fixture-Auth ohne Credentials liefert `auth_required`; ungültige
  Member-IDs bleiben `not_a_member`.
- [x] Settlement-GET setzt `Cache-Control: no-store` auch bei Auth-Rejection.
- [x] Idempotency-, Push-, JSON-Body-, Inventory- und Member-Regressionen lokal
  ausgeführt.
- [ ] Fire-and-forget-Fehler und normale UI-Aktionen sichtbar weiterreichen.
- [ ] Cross-WG-Member-/Parent-Kombinationen an DB-Grenzen prüfen.
- [ ] RLS-Denial und revoked-membership im geschützten Preview nachweisen.

### T5 — UX, Accessibility und Kernflüsse

Status: in Arbeit

Abnahme: Entry, Dashboard, Ausgaben, Einkauf, Putzen, Pinnwand/Chat,
Einstellungen, Offline/Retry/Draft und Account-/WG-Wechsel sind bei 320px und
390px, Light/Dark, Tastatur und reduzierter Bewegung nachvollziehbar.

- [x] Vorhandene fokussierte UX-/Offline-/PWA-/Account-Wechsel-Regressionen
  lokal grün.
- [ ] Alle Kernflüsse mit initial, leer, loading, success, failure, offline und
  recovery prüfen.
- [ ] Brandbook-Vertrag und Header-/Touch-Target-Regeln gegen geänderte Views
  prüfen.
- [ ] Residenten-Usability-Runde mit fünf unterschiedlichen WG-Nutzern
  durchführen oder als externe Produktentscheidung dokumentieren.

### T6 — Geschützte Preview-Abnahme: Migration, Auth und Privacy

Status: blockiert

Abnahme: Derselbe Candidate-SHA besteht Preview-Migration/db:check,
vertrauenswürdiges Vercel-Event, QA-Secrets, authentifizierten Browser-Satz,
RLS-Denial, revoked membership, Zwei-Nutzer-Privacy und Cleanup.

Blocker: erforderliche Preview-DB-/Auth-/Bypass-Secrets und Provider-Owner-
Freigaben sind nicht im Repo und werden nicht geraten oder eingetragen.

### T7 — Provider, PWA und Geräte

Status: blockiert

Abnahme: Sichtbare Integrationen (S3, Rate-Limit, Push, Kalender, PayPal,
Import/Export, Offline-Reconciliation) und mindestens ein iOS- sowie Android-
Pfad sind real geprüft oder mit sichtbarer Defer/Hide-Entscheidung versehen.

Blocker: echte Provider-Zugänge, Geräte-/Installationsnachweise und sichere
externe Testdaten fehlen.

### T8 — Recovery, Monitoring und Produktionsbetrieb

Status: blockiert

Abnahme: Backup/PITR, RPO/RTO, Restore-Drill, Monitoring/Alerting,
Support-Ownership, kompatibler Rollback und kontrollierte Produktionsfreigabe
sind für denselben SHA belegt.

Blocker: Produktionsdaten, Secrets, Migration, Deployment und irreversible
Provider-Aktionen sind ohne zusätzliche Freigabe nicht autorisiert.

### T9 — Abschluss und Release-Entscheidung

Status: offen

Abnahme: T2–T8 sind aktuell belegt, alle P0/P1-Gates sind erledigt oder
explizit blockiert, keine kritischen Bugs oder Platzhalter bleiben offen, und
der Abschlussbericht nennt SHA, Tests, externe Lücken und Rollback-Status.

## Kontrolllauf

- Letzter manueller Lauf: 2026-09-19, aktueller Arbeitsstand.
- Lokaler Befund: Lint/Typecheck/Analytics/OpenSpec/Build/Bundle/Fix-E2E und
  fokussierte Gates grün; externer Preview-/Provider-/Recovery-Nachweis offen.
- Nächste Aktion: T2-Automation nach read-only Inventar einrichten, danach T3–T5
  mit aktuellem Candidate-SHA weiterführen.

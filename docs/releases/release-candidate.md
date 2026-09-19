# ManaWG Release Candidate Evidence

Status: BLOCKED — kein freigegebener Release-Kandidat
Stand: 2026-09-19, Europe/Berlin
Checkout: /Users/abu/Company/manawg-app
Basis-Commit: cf357456b0078df0fbe7f5c64d86a2f0135d4d86
Arbeitsbaum: uncommitted; dieser Nachweis ist kein Deployment- oder Produktionsfreigabeprotokoll.

## Aktuell verifiziert

Mit Node 22/pnpm 9 und dem aktuellen Arbeitsbaum:

- Lint: Exit 0.
- Typecheck: Exit 0.
- Production Build: Exit 0 nach Entfernen eines stale lokalen Testservers und Clean-Build.
- Bundle-Budget: Exit 0; Shared First-Load JS 102.0 kB bei 120 kB Budget.
- Analytics Privacy: Exit 0.
- OpenSpec strict: 5/5 Änderungen bestanden.
- Fixture-E2E: Exit 0 nach dem Fix der Auth-Fehlerprecedence und des Settlement-Cache-Tests.
- Fokussierte Regressionen: Exit 0.
- Release-Workflow-Gates: 7/7 bestanden.
- Playwright-Testdiscover: 77 Tests in 28 Dateien.
- git diff --check: bestanden.
- pnpm audit --prod --audit-level high: keine bekannten Schwachstellen.

## Behobene Root Causes

- Der DB-down-Fixture-Preamble meldete bei anonymen Requests member_id_required statt auth_required; die Guard-Antwort ist jetzt konsistent mit der server-verifizierten Authentifizierung.
- Der Settlement-Cache-Test erwartete mit einem untrusted Member-Header einen DB-Catch-Fehler. Der Header authentifiziert nicht; der Test prüft jetzt die tatsächlich erreichbare 401-Rejection mit Cache-Control: no-store.

## Nicht freigegeben

Diese Nachweise fehlen weiterhin und dürfen nicht aus lokalen Fixture-/Source-Checks abgeleitet werden:

- echter Nicht-Fixture-Testlauf gegen DB/Auth;
- geschützte Preview-Migration und db:check auf demselben eingefrorenen SHA;
- authentifizierter Preview-Browserlauf, QA-Account, Vercel-Event und Cleanup;
- anonyme/authentifizierte RLS-Denial- und revoked-membership-Nachweise;
- reale S3-, Rate-Limit-, Push-, Kalender-, PayPal-, Import/Export- und PWA-Provider-/Geräteprüfungen;
- Backup/PITR, RPO/RTO, Restore-Drill, Monitoring, Support-Ownership und Rollback;
- Produktionsmigration, Deployment oder Push.

Externe Secrets, Produktionsdaten und irreversible Provider-Aktionen wurden nicht erraten oder ausgeführt.

## Kontrolllauf

Die aktive Automation manawg-release-control-2026-09-19 läuft alle 30 Minuten isoliert in Europe/Berlin mit Astra High, ohne Chat-Zustellung. Sie prüft TASKS.md, verhindert Doppelstarts laut Run-Regel und stoppt erst nach verifizierter Definition of Done.

## Nächster Nachweis

Candidate-SHA einfrieren, danach die geschützte Preview-Kette mit QA-Secrets, Migration, Auth/RLS, Cleanup und denselben Playwright-Gates ausführen. Bis dahin bleibt die Release-Entscheidung BLOCKED.

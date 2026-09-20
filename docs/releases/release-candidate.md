# ManaWG Release Candidate Evidence

## Protected CI transport repair — 2026-09-20

The first integrated main run for24cd525 reached the real protected DB step and failed with `ENETUNREACH` on the IPv6-only direct endpoint. Preview CI now validates the original pinned direct verifier URL, then explicitly derives the provider's IPv4 session endpoint on5432 with unchanged credentials and `verify-full`; other projects/roles/databases/query overrides and6543 remain rejected. Only CI enables this mode. The ordinary migration/Production direct guard remains unchanged; no credential rotation or role-rights change is involved. The wrapper suppresses all child output/error objects and fails on errors, signals, timeout or output overflow.

The two Preview checking jobs use native GitHub `environment.deployment:false`. Environment secrets, main branch policies and approval rules remain enforced, but checking jobs no longer create deployment records that collide with Vercel's trusted events. Both trusted-bot checks and every exact-SHA guard remain mandatory. GitHub reference: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments#using-environments-without-deployments.

Independent code review approved;24 focused tests,lint,typecheck,YAML and36 shell syntax checks passed. This repair still needs a real protected main CI run; no prior failure is relabeled as success.


## Date integrity verification — 2026-09-20

Subscription due dates now reject empty input rather than silently choosing today. Event drafts retain their dates when a start is cleared or the dialog is reopened. All-day creation/editing uses calendar-day comparison, and agenda/month bounds cover whole days across UTC, Berlin DST, Los Angeles and UTC+14. Existing non-midnight all-day timestamps retain device-local display and unchanged timestamps on metadata-only edits. Exact UTC-midnight values are treated as canonical; indistinguishable historical midnight values cannot recover an original timezone that was never stored. No data migration or bulk rewriting was performed.

Final isolated-worktree verification:131 fixture tests passed,26 environment-specific skips,0 failures; main repeated the full run. Lint,typecheck,production build,analytics privacy,feature boundaries and bundle check passed (102.1/120kB). Fresh independent review found no remaining scoped defects;19 existing cases independently passed. Final hosted/CI evidence must still bind to the integrated candidate SHA.


## Verified implementation checkpoint — 2026-09-20 20:30 CEST

Candidate implementation: `17e5b9004b655538b0b3b544d4363b1ffaedf95f`, clean isolated worktree. Preview `dpl_J7rjVcXEDPxZhhtQFgNmL4MJTrws`, https://manawg-13gh3ylsk-abditubes-projects.vercel.app. Draft PR #156 is not release approval.

- Clean Node22 fixture run:107 passed,26 environment-specific skips. Focused gate/storage/ledger checks:32 passed. Lint/typecheck/build/bundle passed before this documentation update; bundle102/120kB.
- Hosted Preview suite:27/27 passed with retries disabled, after fixing invalid temporary share-code generation and incorrect `/api/wg/mine` rate-limit classification. Own/foreign API privacy verified with two synthetic users; protected Preview bootstrap sends no bypass header/cookie to other origins.
- Private storage: real exact8MiB upload/read SHA256 `55e348d20d20e12c5db5653ac1fad8cff4e340be835951378854db1b523db7c8`; browser decode; private/no-store/nosniff; foreign, anonymous and revoked-member denials; provider oversize/MIME/overwrite rejection, unchanged original content. Boundary tests ran on7640b0c with the identical storage implementation. Real ImageUploader on17e5b90 passed offline IndexedDB persistence, reconnect retry, pending-record removal, online upload, image decode, announcement POST and direct DB readback of its private URL. Owned resources cleaned; explicit readback before the last UI repetition found zero temporary storage users/WGs.
- Protected GitHub Preview secrets exist in the `Preview` environment (main-only policy), including a read-only DB verifier and dedicated QA fixture. Branch deployment jobs are intentionally rejected by that policy, not evidence of missing secrets. A final trusted same-SHA main Preview CI run is still required; exact SHA gates remain mandatory.
- Production alias readback remains `dpl_FGgrF9cd319Sm142KnEz3j7KQWiS`. No Production release or data change. Calendar/date UI corrections, exact recovery ACL proof, provider recovery/retention, physical devices and resident acceptance remain open. Fixture/mobile emulation is not those proofs.


Status: **BLOCKED — kein freigegebener Release-Kandidat**
Stand: 2026-09-20, Europe/Berlin
Checkout: `/Users/abu/Company/manawg-app`
HEAD: `cae9b0bf3f5e6e4a032933acc82fd7a99a301b96` (`main`)
Arbeitsbaum: dirty; kein Candidate-SHA eingefroren.

## Lokal verifiziert

Erneut geprüft am 2026-09-20, 16:54 CEST, mit Node 22.23.2 und pnpm 9.0.0:

- Typecheck, Lint und Feature-Boundaries: Exit 0.
- Production Build: Exit 0.
- Bundle: 102.0 kB shared first-load JS bei 120 kB Budget.
- Analytics Privacy: Exit 0.
- OpenSpec strict: 5/5.
- Fixture-E2E: 85 bestanden, 25 umgebungsabhängig übersprungen, keine Fehler. Die übersprungenen Live-Tests sind kein Auth-/Provider-Nachweis.
- Chat-Read-Recovery: 2/2 passed.
- Social-Login ohne Fixture-Modus: 7/7 bestanden (16:17 CEST), lokaler Server mit öffentlicher Preview-Supabase-Konfiguration; echte Auth-Settings und PKCE-Cleanup geprüft. Kein authentifizierter WG-/Hosted-Nachweis.
- Release-Workflow-Gates: 9/9 passed.
- `git diff --check`: Exit 0.
- Production Dependency Audit: keine bekannten High-Schwachstellen.

Der lokale Gate-Readback auf `cae9b0b` plus dirty Änderungen ist grün.

Unabhängiges Review der Änderungen an ChatView, MemberDeactivateDialog, ProfileTab,
Rate-Limits und Chat-Retry-Test: keine bestätigten Fehler. GitHub hatte zum Readback
keine offenen Issues oder Pull Requests. Beides ersetzt die unten offenen Live-Gates nicht.

## Behobene Root Causes

- Chat-Lesestatus bleibt bei Netzwerk-/503-Fehlern sichtbar und retrybar.
- Fire-and-forget-Fehler beim Auszug und in den PayPal-Profil-Einstellungen werden sichtbar behandelt.
- Vercel Preview behandelt fehlendes/ungültiges Upstash optional; Production bleibt fail-closed.
- Auth-Fehlerprecedence und Settlement-Cache-Header sind durch Regressionen belegt.
- App-Transaktionen beziehen ihre Verbindung aus Runtime-Variablen, nicht mehr aus DATABASE_MIGRATION_URL. Migrationskonfiguration bleibt unverändert. Vor Deployment müssen bestehende Runtime-Aliase gültige, dauerhafte Verbindungen enthalten.
- Der Ledger-Existenzcheck nutzt pg_catalog statt der rollenabhängigen information_schema-Sicht; fehlende Rechte können keine Baseline-Adoption auslösen.
- Drei Resolver- und drei Ledger-Regressionen bestanden. Echter Preview-Schreib-/Rollback-Test mit absichtlich ungültiger Migrations-URL bestand: temporäre Tabelle wurde zurückgerollt, gleiche pg_backend_pid vor/nach dem Fehler bestätigt.

## Preview-Live-Readback

- Supabase Preview `sthiwjebcwwiphashgla`: `ACTIVE_HEALTHY`.
- Repo-Migrationen `0010_enable_public_rls.sql`, `0011_explicit_member_roles.sql` und `0012_pale_drax.sql` wurden nach dem Restore im Preview angewendet.
- 26 öffentliche App-Tabellen haben RLS aktiv; direkte `anon`-/`authenticated`-Abfragen auf `public.wgs` werden mit `permission denied` abgewiesen.
- Keine Preview-Policies oder Rollen-Grants wurden ergänzt; das entspricht dem server-owned Access-Modell.
- Security Advisor: RLS-ohne-Policy ist INFO für das beabsichtigte Modell; Leaked-Password-Protection bleibt WARN.
- Exaktes `db:check` am 2026-09-20 16:40 CEST bestanden, einschließlich Schema, Security, Dateninvarianten, kanonischem Ledger und Transaktions-Rollback. Verbindung über autorisierte CLI-Anmeldung mit deren postgres-Rolle und TLS verify-full/Supabase-CA.
- Drizzle kannte 0000–0009; die bytegenau belegten, bereits über Supabase angewendeten Migrationen 0010–0012 wurden ausschließlich im Ledger ergänzt. Ein Rollback-Probelauf bewies unveränderte ursprüngliche zehn Rows; anschließend wurden genau drei Rows ergänzt.
- Sechs Hosted-Guest-/Auth-/Reset-Checks bestanden. Synthetischer Account und isolierte Test-WG wurden nach jedem Lauf entfernt; unabhängiger Readback: null Testaccounts und null Test-WGs. Der bisherige Deploy liefert bei POST-Mitgliedschaft 500 statt 409; der lokale Runtime-Fix benötigt einen neuen Preview-Deploy und Hosted-Nachweis. Revoked membership und Zwei-Nutzer-Privacy bleiben offen.
- Vercel CLI-Preview `https://manawg-qhpaco526-abditubes-projects.vercel.app` aus clean `main`-HEAD ist `Ready`; `vercel curl /api/health` meldet `database=ok`.
- Korrektur 2026-09-20 17:05 CEST: vercel env pull liefert Redaktionsmarker für sensitive Variablen, keine tatsächlichen Platzhalter. Vorhandene Vercel-Secrets werden im nativen Preview-Deploy genutzt; keine neue DB-Rolle oder Rotation nötig. CLI-Verifikation und dauerhafte CI-Konfiguration bleiben getrennte Nachweise.

## Weiter blockiert

- GitHub-Preview-Event/Candidate-SHA fehlt weiterhin: der alte PR-Deploy war SHA `44554575`, `main` ist `cae9b0b`; der neue CLI-Deploy hat kein GitHub-Deployment-Event.
- Dauerhafte CI-QA-Secrets fehlen; der manuelle Browserlauf verwendete kurzlebige Testaccounts mit anschließendem Cleanup.
- S3, Push, Kalender, PayPal, Import/Export, PWA und echte iOS-/Android-Geräte fehlen.
- Backup/PITR, RPO/RTO, Restore-Drill, Monitoring, Support-Ownership und Rollback fehlen.
- Production bleibt unverändert; dort wurde RLS im direkten Readback noch nicht aktiviert.

Keine Production-Migration, kein Push und kein Deployment wurden ausgeführt. Preview-Migrationen wurden ausschließlich im Preview-Projekt angewendet.

## Kontrollautomation

`manawg-release-control-2026-09-19` bleibt aktiv, alle 30 Minuten, isoliert, Astra High, ohne Zustellung. Der Job ist auf read-only umgestellt und darf keine Dateien mehr ändern.

## Nächster Nachweis

Candidate-SHA einfrieren, Preview mit bestehenden serverseitigen Secrets und zentralem Runtime-Fix deployen und vollständige Hosted-Mitgliedschafts-/Privacy-Gates prüfen. Redigierte CLI-Werte sind kein Beleg fehlender Secrets. Kurzlebige CLI-Logins nicht deployen. Provider-, reale Geräte-, Residenten- und Recovery-Nachweise bleiben separate offene Release-Gates.

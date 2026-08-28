# manaWG — Technische Code-Dokumentation

**Repo:** `~/Company/manawg` · **App:** `apps/web` (einziges Workspace-Paket) · **Stand:** 22. August 2026
**Umfang:** 183 Unit-/Integration-Testdateien, 25 Playwright-E2E-Suiten, 40 API-Routen unter `/api/wg/[code]/*` (46 inkl. Cron/Upload/Health), 24 DB-Tabellen

---

## 1. Monorepo & Build

```
manawg/
├── apps/web/                  # Next.js 15 App-Router-App (das einzige Paket)
├── scripts/                   # check-deps.mjs (Abhängigkeits-Gate auf Root-Ebene)
├── specs/                     # Design-Dokumente
├── docs/                      # architecture.html, business-plan.md, known-issues.md, diese Datei
├── turbo.json                 # Build/Test/Lint/Typecheck-Pipeline mit Cache
├── biome.json                 # Linter + Formatter (ersetzt ESLint + Prettier)
└── pnpm-workspace.yaml        # packages: [apps/web]
```

- **Node ≥ 22, pnpm ≥ 9**, Turborepo orchestriert (`pnpm build` → `turbo build --filter=@manawg/web`)
- `vercel-build`-Script = `node scripts/db-migrate.mjs && next build` — **Migration vor Build**, Fehlschlag bricht das Deploy ab

---

## 2. Verzeichnisstruktur `apps/web`

```
src/
├── app/                       # Next.js App Router
│   ├── page.tsx               # Landing
│   ├── neu/                   # WG erstellen / Code einlösen
│   ├── wg/[code]/             # Dashboard + 13 Unterseiten (ausgaben, chat, einkauf,
│   │                          #   pinnwand, putzen, kalender, vorräte, abos, mahnungen,
│   │                          #   import, suche, aktivität, einstellungen)
│   ├── api/
│   │   ├── wg/                # 40 Route-Handler unter /api/wg/[code]/*
│   │   ├── cron/              # chore-reminders, event-reminders, recurring-advance
│   │   ├── upload/sign/       # S3-Presign
│   │   └── health/            # Smoke-Probe
│   ├── offline/               # SW-Fallback-Seite
│   └── datenschutz|impressum|agb/
├── components/
│   ├── ui/                    # ConfirmDialog, Drawer, Toast, EmptyState …
│   ├── wg/                    # ~100 Feature-Komponenten, gruppiert je Modul
│   │                          #   (chat/, ausgaben/, dashboard/, einstellungen/,
│   │                          #   pinnwand/, einkauf/, import/, putzen/ + Root-Ebene)
│   └── install-*|theme/       # PWA-Install, Theme-Toggle
├── lib/
│   ├── db/                    # connection, index (pg), transaction (pg pool)
│   ├── wg/                    # 56 Domain-Module — die eigentliche Business-Logik,
│   │                          #   inkl. with-wg-route.ts, require-wg-admin.ts
│   ├── api-auth.ts            # Member-Verifikation pro Request
│   ├── member-header.ts       # MEMBER_ID_HEADER/MEMBER_TOKEN_HEADER — ein Ort für beide
│   ├── rate-limit.ts          # Upstash-Sliding-Window-Buckets
│   ├── idempotency.ts         # Postgres-basiertes Response-Replay
│   ├── s3.ts                  # Presigned-PUT-Erzeugung
│   ├── notifications.ts       # Web-Push-Versand
│   ├── clipboard.ts           # Copy-Fallback (execCommand), ein Ort statt drei Kopien
│   ├── hooks/                 # useModalDialog, useDismissableMenu, useFocusTrap,
│   │                          #   useOfflineQueueSync — geteilte UI-Hooks
│   └── share-code.ts, money.ts, time.ts, berlin-day.ts …
├── middleware.ts               # CSP + Rate-Limit-Gate (liegt in src/, nicht unter lib/)
├── test/ test-support/         # Vitest-Infrastruktur, siehe route-harness.ts (§9)
└── e2e/                        # 25 Playwright-Suiten
```

---

## 3. Datenbank-Layer — ein Treiber, klare Trennung

Der wichtigste technische Entscheid im DB-Layer: **ein einzelner `pg`-Treiber (`pg` / `node-postgres` via `drizzle-orm/node-postgres`) für alle Operationen.**

- `lib/db/connection.ts` — validiert `DATABASE_MIGRATION_URL` (muss Port 5432 oder keinen Port für lokale Hosts verwenden; Port 6543 wird abgelehnt), `host.docker.internal`/`localhost`/`127.0.0.1`/`::1`/`*.local` zählen als lokal. Unparsebare URL wirft einen Fehler mit Label. Während der Migration blockiert `MIGRATION_READ_ONLY=true` alle Schreib-Operationen
- `lib/db/index.ts` — Standard-`db` über **`pg` (node-postgres)** gegen `POSTGRES_URL`/`DATABASE_URL` (Supabase Supavisor Pooler, Port 6543) für normale Laufzeit-Queries
- `lib/db/transaction.ts` — nutzt denselben `pg`-Pool für Transaktionen (`pg.Pool`). Historisch existierte ein `@neondatabase/serverless`-Pfad mit WebSocket-Pool für Transaktionen; dieser Pfad ist entfernt — alle DB-Zugriffe laufen jetzt über `pg`

**Migrationen:** `drizzle-kit generate` erzeugt aus dem `schema.ts`-Diff eine nummerierte Migrationsdatei; `scripts/db-migrate.mjs` nutzt `DATABASE_MIGRATION_URL` (Direct/Session Pooler, Port 5432) für DDL und entfernt `-pooler` aus dem Host, falls nötig. Bewusst *nicht* `drizzle-kit push` — das macht bei Renames DROP+ADD statt RENAME.

---

## 4. Authentifizierung — drei Stufen, null Accounts

### Stufe 1: Share-Code (Lese-Zugriff)
`lib/share-code.ts`: 8 Zeichen aus einem Alphabet ohne `0/O/1/I/l`, case-insensitive via `normalizeShareCode()`. Jede Route liest den Code aus den Params — `readShareCode()` in `route-preamble.ts` ist die **einzige** Implementierung (der Kommentar zitiert einen realen Rate-Limit-Bypass, der durch eine gedriftete Kopie der Client-IP-Logik entstand: „Copies drift").

### Stufe 2: HMAC-Member-Token (Identität)
`lib/wg/member-token.ts` — der eleganteste Teil des Codes:

```
token = HMAC-SHA256(MEMBER_SESSION_SECRET, "${wgId}:${memberId}")
```

Deterministisch: Der Server **speichert keine Session**, sondern rechnet das erwartete Token für jedes `(wgId, memberId)`-Paar nach. Konsequenzen:
- keine Session-Tabelle, kein Expiry-Bookkeeping, keine Migration für Bestands-Members
- Verifikation mit `timingSafeEqual` (konstante Zeit), fail-closed: fehlender Token, fehlender Secret oder Längen-Mismatch → `false`, nie ein Throw
- schließt die Spoofing-Lücke, die `x-manawg-member-id` (nackte UUID, ablesbar von `GET /members`) allein offenließ

### Stufe 3: Admin-Gate
`api-auth.ts` liefert `VerifiedMember { verified: boolean }` — `false` = Legacy-Request (Header passte, aber kein/invalid Token). Nicht-destruktive Routen akzeptieren Legacy; Admin-Mutationen (`checkWgAdminAccess`) verlangen zwingend `verified === true`.

---

## 5. Request-Pipeline

Jeder `/api/wg/[code]/*`-Request läuft durch:

1. **`src/middleware.ts`** — Rate-Limit-Gate (Upstash Redis, Sliding Window) + **CSP-Header**: striktes `default-src 'self'`, S3/Supabase/jsdelivr als explizite `connect-src`, `worker-src blob:` für Tesseract-OCR-WASM
2. **`readShareCode()`** — syntaktische Prüfung, bewusst *vor* Body-Parsing (mehrere Tests fixieren diese Fehler-Präzedenz: `invalid_share_code` schlägt Validierungsfehler)
3. **E2E-Fixture-Gate** — `NEXT_PUBLIC_DB_DOWN=true` beantwortet Requests ohne DB (dafür existiert die Datei getrennt von api-auth, damit api-auth im db-down-Modus ungeladen bleibt — ein Route-Test assertiert das)
4. **`requireWgMember()`** — DB-Lookup: Code → WG, Member-Header + Token → `VerifiedMember`
5. **Idempotency** (`lib/idempotency.ts`) für Schreib-Routen:
   - Client sendet `Idempotency-Key` (UUID-Format)
   - `claimResponseSlot()` insertet auf `(scope, key)`-Primary-Key — **bei zwei parallelen Cold-Lambdas gewinnt genau einer**, der andere spielt die gecachte Response ab (32-KiB-Cap)
   - **Postgres, nicht Redis** — der Kommentar dokumentiert den iter-13-Outage: Prod hatte leere `UPSTASH_*`-Strings, stilles Disablement verursachte doppelte Expense-Inserts. Response-Replay läuft deshalb *immer* gegen Postgres; Redis nur noch für Audit-Dedupe
6. **Domain-Logik** in `lib/wg/<modul>.ts` — reine, testbare Funktionen; die Route ist nur Klebstoff

Schritte 2+3 plus Try/Catch/Log wiederholten sich zeichengleich in 72 der 75 Handler-Funktionen; `with-wg-route.ts` (`withWgRoute()`) fasst sie zu einem Wrapper zusammen, den inzwischen 35 der 40 `route.ts`-Dateien unter `/api/wg/[code]/*` nutzen. PATCH und DELETE auf der WG selbst (Rename/Delete) haben zusätzlich `require-wg-admin.ts` (`requireWgAdmin()`) — die vier Prüfschritte Code→WG, Member, Admin-Status, Rate-Limit-Slot standen vorher wortgleich in beiden Handlern.

### Rate-Limit-Buckets (`lib/rate-limit.ts`)

| Bucket | Limit | Zweck |
|---|---|---|
| `reg` | 3/h/IP | Registrierung |
| `wg-code-lookup` | 20/min/IP | Share-Code-Brute-Force-Defense |
| `wg-read` / `wg-write` | 120/min / 30/min | Middleware-Default |
| `chat-msg` | 20/min/Member | Chat-Anti-Spam |
| `wg-export` | 20/h/Member | eigener Bucket — Export dumpt die ganze WG |
| `import-commit` | 3/h/Member | Bulk-Import |
| `reminder-send` | 10/h/Member | Mahn-Anti-Spam |

---

## 6. Domain-Logik (`src/lib/wg/`) — die wichtigsten Module

### Geld: `split-math.ts`, `money.ts`, `debts.ts`, `debt-reduction.ts`
- Beträge sind **immer Integer-Cents** — nie Floats an der Grenze („333.333…-Cent-Problem"). `CENTS_PER_EURO` (in `money.ts`) ist die einzige Definition; vorher stand die `100` fünfmal verstreut
- Splitting nach **Hamilton / Largest-Remainder**: jeder erhält `floor(amount/n)`, die < n Rest-Cents gehen einzeln an die ersten k Debitor. Garantien: `sum(splits) === amount` exakt, `max−min ≤ 1 Cent`, deterministisch
- Fairness über Rotation: der Aufrufer dreht die Debitor-Liste um `expenseCount % n`, damit der +1-Cent-Empfänger pro Ausgabe wechselt
- `debt-reduction.ts`: Schulden-Graph zu Mindest-Überweisungen (wer überweist wem wie viel, statt n² Paare)
- `open-expenses.ts` (`groupSplitsByExpense`): gruppiert Split-Zeilen und normalisiert `settledAt` — `pg` liefert dafür einen String; beide Aufrufer (Open-Expenses-Liste, Settle-Batch) nutzen jetzt dieselbe Normalisierung
- `announcement-lookup.ts` (`findWgAnnouncement`): WG-gescopte Announcement-Lookup für Comments/Reactions — ohne das WG-Scope im `where` könnte ein Member eine Announcement-ID aus einer fremden WG ansprechen

### Chores: `chore-recurrence.ts`, `chore-fairness.ts`
- Zwei Kadenzen: `days` (ms-basiert, Legacy) und `months` (`Date.setMonth()`, Kalender-Anker — 12-Monats-Chore landet exakt am selben Kalendertag statt ~5 Tage zu driften)
- `chore-fairness.ts` berechnet faire Rotation über die Historie (eigene Edge-Case-Testsuite `fairness-edge-cases.test.ts`)

### Events: `events.ts`
- Formular-Validierung (Titel Pflicht, Start Pflicht, Ende nicht vor Start) als reine Funktion statt inline in `EventCreateModal`/`EventEditModal` — beide Modals riefen vorher dieselben drei Prüfungen dupliziert im Submit-Handler auf; Ende === Start ist erlaubt

### Recurring Expenses: `recurring-expenses.ts`
- `anchorAt`-Feld: Monats-Fortschreibung hält den Tag-des-Monats fest (31.01 → 28.02 → 31.03), statt von geklemmten Ergebnissen zu ketten (31.01 → 28.02 → 28.03)
- Partial-Unique-Index `(recurring_expense_id, recurring_due_at) WHERE NOT NULL` macht Doppel-Erzeugung auf DB-Ebene unmöglich

### Import: `import-parsers.ts`, `import-hash.ts`, `import-commit.ts`, `ocr.ts`
- CSV-Parser für Splitwise/Splid-Exporte, `ocr.ts` läuft **Tesseract.js client-side** (deu+eng, WASM per `worker-src blob:`) für Beleg-Screenshots → `ParsedExpense`
- `rawPayloadHash` + `importDuplicateKey` mit Partial-Unique-Index = idempotenter Re-Import

### Offline: `offline-queue.ts`, `offline-conflicts.ts`, `offline-client.ts`, `offline-images.ts`
- Typisierte Offline-Action-Queue (`shopping.create`, `chore.complete`, `expense.create`, …) mit `attempts`/`lastAttemptAt`/`lastError`
- Konflikt-Auflösung und Risiko-Erklärungen pro Aktionstyp — der User sieht beim Retry, was passieren kann

### Dashboard & Suche: `dashboard-data.ts`, `dashboard-insights.ts`, `search.ts`
- Ein Aggregat-Endpoint für die Dashboard-Kacheln; Insights ableiten Salden/Status serverseitig

---

## 7. Frontend-Architektur

- **RSC** für Seiten-Shell und SEO-relevante Routen; Client-Components für alles Interaktive
- **`WgContextProvider`** — WG-Kontext (Code, Member, Identität) für den `[code]`-Baum
- **Zustand** für UI-State, **React Query** für Server-State (Cache, Retries, Invalidation)
- **Chat-Polling** (`useChatChannel`): 8-s-Tick, pausiert bei `document.hidden`; `mode`-Feld als Forward-Compat-Hook für späteres echtes Realtime
- **PWA:** `sw.js` (v2) cached die App-Shell (`/`, `/offline`, Icons, Manifest) cache-first, Push-Handler mit validiertem Payload-Fallback; Install-Prompt mit Dismissal-Persistenz
- **UI-Primitives:** ConfirmDialog (mit Fokus-Falle via `useFocusTrap`), Drawer, Toast
- **`useModalDialog`** (`lib/hooks/`) — das native `<dialog>`-Lifecycle (open/close, Escape, Backdrop-Klick) plus Event-Serialisierung, einmal statt in jedem Dialog neu verdrahtet; `ConfirmDialog` und `MemberDeactivateDialog` sind die Konsumenten
- **Geteilte Banner** statt zehn Inline-Kopien: `OfflineBanner`, `ActionNoticeBanner`, `LoadErrorBanner` (`components/wg/`)

---

## 8. Hintergrund-Jobs

| Route | Trigger | Arbeit |
|---|---|---|
| `/api/cron/chore-reminders` | Vercel Cron | fällige Chores finden (Urlaub beachten), Push senden, `lastReminderAt` setzen |
| `/api/cron/event-reminders` | Vercel Cron | Events im Reminder-Fenster (`berlin-day.ts` für Tagesgrenzen in Europe/Berlin) |
| `/api/cron/recurring-advance` | Vercel Cron | fällige Abos → Expense + Splits erzeugen (tx!), `nextDueAt` per Anker weiterschieben |

Alle prüfen `CRON_SECRET`, alle nutzen die Notification-Pipeline (`notifications.ts` + `notification-dispatch.ts`): Member-Prefs (`notifyChores` etc.), Quiet Hours (`quietStartHour/EndHour`), Push-Subscriptions aus `push_subscriptions` (VAPID), Versand via `web-push` an FCM/APNs.

---

## 9. Teststrategie

**183 Vitest-Dateien** — Unit-Tests leben *neben* dem Modul (`split-math.ts` → `split-math.test.ts`), Integrationstests auf Route-Ebene (`route.integration.test.ts`). Abgedeckt u. a.:
- Split-Math inkl. Edge-Cases (1 Cent auf 2 Personen, 0-Betrag, Rotation)
- Member-Token (Timing-Safe-Verifikation, Fail-Closed)
- Idempotency (Slot-Race, Replay, 32-KiB-Cap)
- Chore-Fairness (eigene Edge-Case-Suite)
- Offline-Konflikte, Import-Hashes, Export-Schema (Integration gegen DB)

**Route-Test-Harness** (`src/test/route-harness.ts`): gemeinsames Test-Double für alle `/api/wg/[code]/*`-Route-Tests, löst die hand-gemockten Setups ab, die vorher pro Datei ~150 Zeilen `vi.mock()`-Vorlauf brauchten (Schema als String-Literale transkribiert — eine Spalten-Umbenennung ließ solche Tests grün bleiben, während Produktion brach). Der Harness stubbt nur, was in einem Unit-Test wirklich nicht laufen kann (DB-Client, `requireMember`, Notifications/Audit-Events); Drizzle-Operatoren und Schema-Tabellen sind die echten — `db.insert` bekommt das echte `expenses`-Table-Objekt, eine Umbenennung lässt den Test jetzt fehlschlagen statt still zu bestehen. Die `vi.mock()`-Aufrufe selbst liegen in `route-setup.ts`, das Vitest als Setup-Datei für das `route`-Projekt lädt.

**25 Playwright-Suiten** (`e2e/`): Core-Flows, Retry-Verhalten je Modul (`expenses-retry`, `chat-retry`, …), Offline-Seite, Mobile-Shell, Theme, Settings-Zugriff, Abo-Races. Fixtures-Modus (`test:e2e:fixtures`) läuft mit `NEXT_PUBLIC_DB_DOWN=true` gegen gestubbte Daten — kein echtes Postgres nötig.

**Qualitäts-Gates:** `biome check` (lint+format), `tsc --noEmit` (strict), `check:deps` (Root-Script gegen unerwünschte Imports), `check-bundle-budget.mjs` (Bundle-Größen-Limit), `ANALYZE=true` für Bundle-Analyse.

---

## 10. Sicherheit — Zusammenfassung

| Maßnahme | Ort |
|---|---|
| CSP, HSTS preload, X-Frame-Options DENY, Permissions-Policy | `next.config.ts` + `middleware.ts` |
| Rate-Limits (13 Buckets, sliding window, Upstash) | `rate-limit.ts`, Middleware |
| HMAC-Member-Token, `timingSafeEqual`, fail-closed | `member-token.ts` |
| Admin-Mutations-Gate | `api-auth.ts` (`checkWgAdminAccess`) |
| Idempotency gegen Doppel-Writes | `idempotency.ts` (Postgres-Claim) |
| Presigned-S3-PUT, TTL 5 Min | `s3.ts`, `/api/upload/sign` |
| CRON_SECRET auf allen Jobs | `/api/cron/*` |
| Input-Validierung | Zod in `lib/validators` + Route-Body-Checks |
| Kein Credential-Store | kein Login = keine Passwort-DB |

---

## 11. Bemerkenswerte Engineering-Entscheidungen

1. **Ein Preamble statt 42 Kopien** — `route-preamble.ts` existiert, weil kopierte Guards drifteten und ein realer Rate-Limit-Bypass daraus entstand. Ein Fix landet jetzt überall gleichzeitig.
2. **Ein DB-Treiber statt zwei** — `pg` (node-postgres) für alles; `DATABASE_MIGRATION_URL` trennt Migrations von normalen Operationen. Die Alternative (zwei Treiber + WebSocket-Pool) brachte Atomicitäts-Probleme und ist jetzt vereinfacht.
3. **Idempotency in Postgres, nicht Redis** — gelernt aus einem echten Vorfall (iter 13): stilles Redis-Disablement → doppelte Buchungen.
4. **Deterministisches Session-Token** — HMAC statt Session-Tabelle: weniger State, keine Migration, kryptografisch bindend.
5. **Partial-Unique-Indizes als letzte Verteidigung** — gegen Doppel-Abos und doppelte Import-Zeilen entscheidet die DB, nicht die App.
6. **Soft-Delete mit FK-Politik-Dokumentation** — das Schema kommentiert, welche FKs bei künftigem Member-Removal restrict bleiben müssen; die Entscheidung ist vorweggenommen, nicht vergessen.
7. **Ein Home statt mehrerer Kopien, konsequent durchgezogen** — `member-header.ts` für die beiden Header-Konstanten (vorher zwei Re-Export-Pfade über `api-auth.ts`/`identity.ts`), `announcement-types.ts` re-exportiert `AnnouncementKind/-Source/-Status` aus `announcement-workflow.ts` statt sie ein zweites Mal von Hand zu deklarieren. Dieselbe Denkweise steht hinter `withWgRoute`, `requireWgAdmin`, `groupSplitsByExpense`, `findWgAnnouncement`, `CENTS_PER_EURO`, `clipboard.ts` und `useModalDialog` (§5–7): eine Kopie, die von der anderen abweicht, ist der eigentliche Bug, nicht die Duplizierung selbst.

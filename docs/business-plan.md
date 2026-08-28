# manaWG — Business Plan & Architektur-Dokumentation

**Stand:** August 2026 · **Status:** Live (manawg.com) · **Vertraulich:** privat

---

## 1. Executive Summary

manaWG ist eine private Web-App für WGs (Wohngemeinschaften): Ausgaben fair teilen, Putzplan rotieren lassen, Einkaufsliste gemeinsam führen, Pinnwand statt WhatsApp-Chaos.

Das Alleinstellungsmerkmal ist konsequent durchgezogene **Login-Freiheit**: Keine Registrierung, keine E-Mail, keine Passwörter. Eine WG existiert als 8-stelliger Share-Code — der Code *ist* das Geheimnis. Wer den Link hat, ist dabei; wer ihn verliert, ist draußen. Das eliminiert den größten Reibungsverlust jeder WG-App (Account-Einrichtung × 4 Personen) und minimiert den Datenschutz-Aufwand (DSGVO Art. 5: Datenminimierung by design).

**Technologie:** Next.js 15 PWA auf Vercel (Frankfurt), Supabase Postgres (via `pg` + Drizzle ORM), AWS S3 für Bilder. Stateless — keine Sessions, keine Edge Functions, kein WebSocket. Historisch lief die DB über Neon/Vercel Postgres (`@neondatabase/serverless`); die aktuelle Architektur nutzt ausschließlich `pg` (siehe `docs/code-architecture.md`).

---

## 2. Produkt

### 2.1 Module

| Modul | Problem | Lösung in manaWG |
|---|---|---|
| **Ausgaben** | „Wer schuldet wem was?" endet in Excel-Chaos | Automatischer Split, Live-Salden, Batch-Ausgleich, Mahnwesen, wiederkehrende Kosten (Miete!) mit Monats-Anker |
| **Putzplan** | Pläne hängen am Kühlschrank und sterben | Selbst-rotierende Zuweisung, Urlaubsmodus (Abwesenheiten), Kalender- und Monats-Kadenz |
| **Einkauf** | Drei parallele Notiz-Apps | Eine Liste, wer kauft ein, hakts ab — abgeschlossene Items wandern als Ausgabe in die Abrechnung |
| **Pinnwand** | Wichtiges versinkt im Gruppen-Chat | Drei-Zeilen-Format, Pin, Reactions, Kommentare, Lese-Bestätigung |
| **Chat** | WhatsApp = privater Kontext | In-App-Chat mit Reactions, Mentions, Read-State, System-Nachrichten |
| **Vorräte** | „Sind noch Toilettenpapier da?" | Inventar mit Schwellenwerten und Verbrauchs-Log |
| **Kalender** | WG-Termine nirgends sichtbar | Events mit Recurrence, Reminder per Push |

### 2.2 Zielgruppe

WGs mit 2–6 Personen, digital-affin, mobile-first. Primärer Vertriebskanal: Mundpropaganda („schick mir den Code"). Kein Marketing-Budget, kein Growth-Team — die App muss sich in 60 Sekunden von „Link bekommen" bis „erster Eintrag" bedienen lassen. Genau dafür ist das Auth-Modell gebaut.

### 2.3 Positionierung

| | WhatsApp-Gruppe | Splitwise & Co. | manaWG |
|---|---|---|---|
| Account nötig | ja (Telefonnummer) | ja (E-Mail) | **nein** |
| Ausgaben-Split | nein | ja | ja |
| Putzplan | nein | nein | ja |
| DSGVO-Minimalismus | nein | nein | ja |
| Server-Standort EU | nein | nein | ja (fra1/eu-central) |

---

## 3. Geschäftsmodell

**Privates Projekt. Kein Umsatz, keine Ads, keine Tracker, kein externer Support.**

Die Kostenstruktur ist bewusst nahe null gehalten:

| Position | Kosten/Monat (ca.) |
|---|---|
| Vercel Hosting (Hobby/Pro) | 0–20 $ |
| Supabase Postgres (Free Tier) | 0 $ |
| AWS S3 (wenige MB Belegfotos) | < 1 $ |
| Domain manawg.com | ~1 $ (Jahrespreis/12) |

Skalierung ist kein Thema: Eine WG erzeugt vernachlässigbaren Traffic. Der Engpass wäre S3-Upload-Missbrauch — abgedeckt durch Presigned-URLs (TTL 5 Min) statt offener Endpunkte.

**Falls das Produkt je produktisiert würde** (nicht geplant): Der einzige sinnvolle Hebel wäre ein Freemium-Modell pro WG (Basis gratis, Premium-Features wie Beleg-OCR, Erinnerungs-Automatik, Export). Die Architektur steht dem nicht im Weg — sie müsste nur einen Billing-Provider bekommen. Alles andere (Multi-Tenancy über `wg_id`) ist bereits so gebaut.

---

## 4. Technische Architektur

### 4.1 Übersicht

Das vollständige Diagramm liegt unter `docs/architecture.html`.

```
Browser (PWA)                      Vercel fra1                      Externe Dienste
─────────────                      ───────────                      ──────────────
React/Tailwind      ──HTTPS──►  Next.js 15 App Router
LocalStorage:                      │
  {wgCode→memberId}                ├─► API-Routes (~40)   ──Drizzle──►  Supabase Postgres
+ HMAC-Token                       │    (api-auth-Guard)                eu-central-1
                                   ├─► Vercel Cron (3 Jobs) ──► Web-Push (VAPID→FCM/APNs)
Service Worker ◄───────────────────┘
Web-Push-Empfang                   └─► POST /api/upload/sign ──► AWS S3
                                       (Presigned PUT, TTL 5min)   ▲
Browser ────────────── Direktupload (PUT) ──────────────────────────┘
```

### 4.2 Schichten im Detail

**Präsentation (Client)**
- Next.js 15 App Router, React Server Components für Seiten, Client-Components für Interaktion
- PWA: `manifest.json`, `sw.js`, Install-Prompt, Offline-Fallback-Seite
- Chat-Aktualisierung per 8-s-Polling mit Visibility-Pause — bewusst kein WebSocket, damit der Server stateless bleibt
- Identität im LocalStorage: `{ wgCode → memberId }` plus HMAC-Member-Token

**API-Layer (Vercel)**
- ~40 Route-Handler unter `/api/wg/[code]/*` — expenses, splits, settle, chat, pinnwand, einkauf, chores, events, vorräte, abos, mahnungen, imports, export, suche, members, notifications
- Jeder Schreib-Request läuft durch `api-auth.ts`: Share-Code-Prüfung, Member-Header-Verifikation, HMAC-Token-Pflicht für Admin-Mutationen
- Querschnitt: Idempotency-Keys (Retry-safe), Rate-Limiting, Audit-Events pro WG

**Daten-Layer (Supabase Postgres)**
- ~25 Drizzle-Tabellen, Kernkette: `wgs → wg_members → expenses/expense_splits` sowie die Fachtabellen (chat, pinnwand, chores, events, inventory, recurring_expenses, absences)
- Migrationen laufen im `vercel-build`-Schritt **vor** dem Build — schlägt eine Migration fehl, wird nichts deployt. Der Code läuft nie gegen eine un-migrierte DB
- „Auszug" eines Members = Soft-Delete (`deactivatedAt`); sechs RESTRICT-Foreign-Keys verhindern, dass Finanz-Historie beim Hard-Delete korruptiert

**Bild-Pfad (S3)**
- Server signiert nur (`POST /api/upload/sign`, Presigned PUT, TTL 5 Min)
- Browser lädt direkt zu S3 eu-central-1 — kein Bild-Byte durchläuft Vercel. Billig, schnell, skaliert gratis

**Hintergrund-Jobs (Vercel Cron)**
- `chore-reminders`, `event-reminders`, `recurring-advance` — per `CRON_SECRET` gegen Missbrauch geschützt
- Recurring-Expenses nutzen einen Monats-Anker (31.01 → 28.02 → 31.03), kein Drift durch verkettete Arithmetik

### 4.3 Sicherheitsmodell

1. **Share-Code** (8 Zeichen, case-insensitive, ohne 0/O/1/I/l) = Besitz-Nachweis für Lese-Zugriff
2. **HMAC-Member-Token** = Nachweis für Identität; Admin-Mutationen (Mitglieder verwalten, WG löschen, Code rotieren) verlangen `verified === true`
3. **Code-Rotation + `joining_enabled`** = Ausschluss-Mechanismus ohne Account-Verwaltung
4. **Security-Header** (HSTS preload, X-Frame-Options DENY, Permissions-Policy), Rate-Limits, Idempotency
5. **Keine Passwörter** = keine Credential-Store-Angriffsfläche

---

## 5. Kernprozesse

### 5.1 Prozess: WG-Gründung (Time-to-Value < 60 s)

```
Landing (/) → „Loslegen" → /neu
  → WG-Name eingeben + Mitglieder anlegen
  → Server generiert 8-char Code (Kollisionssicher, eindeutige Zeichen)
  → Gründer wählt sich als Identität → LocalStorage
  → Code/Link an Mitbewohner teilen
```

### 5.2 Prozess: Beitritt (auf neuem Gerät)

```
Link öffnen (/wg/K7H29PQR)
  → Server prüft Code (unique index) + joining_enabled
  → Identity-Picker: aktives Mitglied wählen ODER neu anlegen
  → Wahl → LocalStorage {wgCode → memberId} + HMAC-Token
  → Dashboard
```

### 5.3 Prozess: Ausgabe erfassen → Schuldenstand

```
Ausgabe anlegen (Betrag, Beschreibung, ggf. Belegfoto)
  → [Foto] POST /api/upload/sign → Browser PUT → S3 → imageUrl speichern
  → Server: expenses-Zeile + N expense_splits (gleiche Cents-Verteilung, Rest auf letzten)
  → Idempotency-Key verhindert Doppelbuchung bei Retry
  → Salden live: Summe(paid_by) − Summe(splits je Debtor)
  → Push an betroffene Member (Prefs + Quiet Hours beachten)
```

### 5.4 Prozess: Einkaufs-Loop

```
Item auf Liste → jemand kauft → abhaken (boughtBy, boughtAt)
  → optional: Betrag erfassen → erzeugt Ausgabe mit Splits
  → Unique-Index verhindert doppelte offene Items (normalized_name)
```

### 5.5 Prozess: Putzplan-Rotation

```
Chore mit Kadenz (N Tage oder N Monate) + zugewiesenem Member
  → Cron/View: wer ist fällig? (Urlaub in member_absences → überspringen)
  → „Erledigt" → chore_completions → nextDueAt = now + Kadenz → nächstes Member
  → Reminder-Push vor Fälligkeit (lastReminderAt verhindert Spam)
```

### 5.6 Prozess: Deployment (CI/CD)

```
git push → GitHub → Vercel Build
  1. pnpm install (pnpm-lock, Node ≥ 22)
  2. node scripts/db-migrate.mjs   ← Migrationen GEGEN die Umgebungs-DB
     (Preview → manawg-preview, Production → bwsvsvfgbrsonepffqff auf Supabase; getrennt via DATABASE_MIGRATION_URL/POSTGRES_URL)
     Fehlschlag → Build bricht ab → kein Deploy
  3. next build
  4. Deploy auf fra1 · Smoke: /api/health
```

Lokal: `pnpm db:generate` (Schema-Diff → Migrationsdatei) vor `db:migrate`. `drizzle-kit push` ist verboten (DROP+ADD bei Renames = Datenverlust).

### 5.7 Prozess: Entwicklung & Qualität

```
Schema-Änderung:  schema.ts → db:generate → db:migrate → Tests
Code-Änderung:    Biome (lint/format) → tsc --noEmit → Vitest (Unit)
                  → Playwright (E2E) → Turbo-Build
Release:          main-merge → Vercel → Migration+Build → Live
```

Qualitäts-Gates sind im Repo verankert: Unit-Tests neben jedem Modul (`*.test.ts`), Integrationstests auf API-Ebene, E2E-Flows in `e2e/`, `check:deps` gegen ungewollte Abhängigkeiten.

### 5.8 Prozess: Datenschutz-Anfragen (DSGVO)

```
Auskunft/Löschung:  /wg/[code]/export (JSON-Export der WG)
Löschung:           WG-Einstellungen → ganze WG löschen (Cascade über alle Tabellen)
Minimierung:        keine E-Mails, keine Passwörter, keine Tracker —
                    es gibt schlicht nichts, was man abmelden müsste
Hosting:            Vercel fra1 + Supabase eu-central + S3 eu-central-1 (alles EU) — historisch Neon eu-central
```

---

## 6. Risiken & Gegenmaßnahmen

| Risiko | Wahrscheinlichkeit | Gegenmaßnahme (verbaut) |
|---|---|---|
| Share-Code leakt (Screenshot, Gruppe) | mittel | Rotation in Einstellungen, `joining_enabled` off |
| Gerät verloren → Identität weg | mittel | Neuer Identity-Pick am selben Gerät möglich; Admin kann Member neu anlegen |
| S3-Missbrauch (offene Uploads) | niedrig | Presigned PUT, TTL 5 Min, Bucket nur für App |
| Supabase/Vercel-Outage | niedrig | Managed Services, EU-Region, `/api/health` für Monitoring |
| Datenverlust durch Schema-Fehler | niedrig | Migrations-Dateien statt push, Migration im Build-Gate |
| Member-Auszug korruptiert Historie | niedrig | Soft-Delete + RESTRICT-FKs |
| Doppelte Buchungen bei Netz-Retry | niedrig | Idempotency-Responses-Tabelle |

---

## 7. Roadmap (offene Baustellen)

1. **Member-Removal sauber implementieren** — Schema-Kommentare dokumentieren die FK-Politik bereits (restrict/cascade); Feature fehlt noch
2. **Realtime für Chat** — `chat-channel.ts` hat das `mode`-Feld als Forward-Compat-Hook; aktuell bewusst Polling
3. **Push-Optimierung** — Quiet-Hours und Prefs sind im Datenmodell, Auswertung weiter verfeinern

Alles andere ist bewusst **nicht** geplant (YAGNI): Mobile-App (PWA reicht), Auth-Server, Multi-WG-Übersicht, Billing.

---

## 8. Fazit

manaWG ist das Gegenstück zum üblichen WG-App-Schrott: kein Account-Zwang, kein Feature-Bloat, ein Stack der um 3 Uhr nachts niemanden aus dem Bett holt. Die Architektur opfert Rechenzentrum-Komplexität zugunsten eines einzigen Sicherheitsprinzips (der Code ist das Geheimnis) und hält dadurch den Betrieb bei ~0 € und die Angriffsfläche bei fast null. Das Dokumentierte ist gebaut, das Gebaute ist getestet, das Getestete ist live.

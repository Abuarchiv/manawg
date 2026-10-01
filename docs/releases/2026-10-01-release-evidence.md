# Release-Nachweis — 2026-10-01 (Nacht-Release)

Production `app.manawg.com` läuft auf `main` (Deploy per Vercel-API, Region fra1,
`/api/health` ok, Prod-Migrationsstand 18 = Journal 18). Gemergt und deployt:
#549–#551, #552 (Bündel: live-members, Audit-Runde 1 für Einstieg/Finanzen/
Haushalt/Austausch/Shell), #554 (Offline-Queue), #556 (Kaltstart-Dedupe), #557
(Einkauf: Enter während laufendem Hinzufügen), #558 (Putzplan offline, 429-Texte,
Formular-Chunk-Preload), #559 (UI-Konsistenz). GitHub Actions laufen wieder
(validate + e2e-fixtures je PR mit Label `run-e2e`, auf main immer).

Lokale Gates je Stand: lint, typecheck, unit 419/419, build + Bundle-Budget
(102,2 kB von 120 kB), Fixture-E2E 511 bestanden / 0 fehlgeschlagen / 43 übersprungen
(Live-Specs ohne DB). Prod-Smoke mit Wegwerf-WG am 2026-10-01: WG anlegen,
Ausgabe, Einkauf (Mengen-Parsing), Putzaufgabe, Chat, Pinnwand, CSV-Export
(BOM, Semikolon, Dezimalkomma), WG löschen – alles ohne Konsolenfehler.

Fixture-E2E im Haupt-Checkout: `.env.local` enthält `VERCEL=1`; das Skript setzt
seit #552 `VERCEL=` zurück, sonst schaltet sich der Fixture-Modus ab.

Weiter offen (nur extern lösbar): PayPal Live-Partner-Freigabe, Supabase Free ohne
PITR/Backups, echte Geräte-Abnahme durch Bewohner.

Vorheriger Stand: [2026-09-30](2026-09-30-release-evidence.md).

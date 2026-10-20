# Echt-Test gegen lokalen Supabase-Stack

Prüft Anmeldung, Mails, Einladungen, Ausgaben, Putzplan, Chat, Übernahme, Konto löschen und Sitzungs-Erneuerung gegen echtes Supabase und echtes Postgres statt Fixtures.

1. `supabase init` in einem Wegwerf-Ordner, dort `supabase-config.toml` als `supabase/config.toml` einsetzen und die Vorlagen aus `supabase/templates/` nach `tpl/` kopieren.
2. `supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor`
3. Migrationen in Journal-Reihenfolge per `psql -f` einspielen (`db:migrate` verlangt Port 5432).
4. App im Produktionsmodus bauen und auf Port 3140 starten. Alle Variablen aus `.env.local` leeren oder auf lokale Werte setzen, sonst trifft der Lauf Prod-Dienste.
5. `SUPABASE_SERVICE_ROLE_KEY` aus `supabase status -o env` setzen, dann `node scripts/real-stack/api.mjs`, `journey.mjs` (mit `SHOTS_DIR`) und `session.mjs`.
6. `modules.mjs` (braucht zusätzlich `CRON_SECRET`, läuft `modules-admin.mjs` mit) prüft jedes Modul über die API; `ui.mjs` (mit `SHOTS_DIR`) klickt alle Seiten im Handy-Viewport durch und legt Screenshots ab. Der Server braucht `VERCEL_ENV=development`, sonst sperrt der Rate-Limiter ohne Upstash.
7. `fuzz.mjs` (zieht `fuzz-access.mjs` und `fuzz-races.mjs` nach) schickt kaputte Bodies, fremde IDs, IDOR- und Race-Versuche gegen jede Schreibroute; `ui-edit.mjs` (mit `SHOTS_DIR`) klickt Action-Sheets, Bearbeiten, Löschen, Einstellungen und Dark Mode durch; `discover.mjs` listet die Bedienelemente je Seite. `ui.mjs` und `ui-edit.mjs` laufen mit `BROWSER=webkit` und `DEVICE='iPhone SE'` (oder `'Pixel 7'`) auch in Safari-Engine und anderen Gerätegrößen; die WebKit-Konsolenmeldungen zu `interactive-widget` und zum CSP-abgelehnten `<style>` stammen aus der Engine bzw. vom Playwright-Screenshot, nicht aus der App.
8. `data.mjs` (zieht `data-load.mjs` nach) prüft Splitwise-Import (Vorschau, Commit, kein Doppelimport), JSON/CSV-Export, die Berliner Monatsgrenze der Abrechnung und danach Last: 400 Ausgaben, 150 Chat-Nachrichten, 60 Einkäufe mit API-Zeiten, Seitenladezeiten und „Mehr anzeigen“ bis zur vollen Liste.
9. `session-expiry.mjs` prüft den Sitzungs-Refresh nach Token-Ablauf (API, fünf parallele Anfragen mit altem Token, Schreiben, Browser-Tabwechsel und Reload). Dafür im Scratch-`supabase/config.toml` `jwt_expiry = 120` setzen und `JWT_EXPIRY=120` übergeben; kleiner als die 90-s-Marge von auth-js geht nicht, sonst refresht jede Anfrage doppelt und das Ergebnis täuscht einen Rauswurf vor. `stale-chunk.mjs` beantwortet den Seiten-Chunk von Einkauf mit 404 wie nach einem Deploy und erwartet genau einen Reload aus der Fehlergrenze.
10. `auth-flows.mjs`: E-Mail-Code-Login im Browser (Code aus Mailpit :54324, falscher Code zuerst), Einladung per Mail (Ledger `mail_log`, ungültige Adresse 400) und Beleg-Upload über Supabase Storage (Signatur, PUT, Lesen als Mitglied/Mitbewohner, Fremder 401 `not_a_member`, ohne Login 401, kaputter Schlüssel 400, fremdes Bild an Ausgabe 400, Widerruf nach Löschen 404).

Die Skripte erwarten die lokalen Standardschlüssel von `supabase start`.

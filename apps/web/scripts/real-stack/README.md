# Echt-Test gegen lokalen Supabase-Stack

Prüft Anmeldung, Mails, Einladungen, Ausgaben, Putzplan, Chat, Übernahme, Konto löschen und Sitzungs-Erneuerung gegen echtes Supabase und echtes Postgres statt Fixtures.

1. `supabase init` in einem Wegwerf-Ordner, dort `supabase-config.toml` als `supabase/config.toml` einsetzen und die Vorlagen aus `supabase/templates/` nach `tpl/` kopieren.
2. `supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor`
3. Migrationen in Journal-Reihenfolge per `psql -f` einspielen (`db:migrate` verlangt Port 5432).
4. App im Produktionsmodus bauen und auf Port 3140 starten. Alle Variablen aus `.env.local` leeren oder auf lokale Werte setzen, sonst trifft der Lauf Prod-Dienste.
5. `SUPABASE_SERVICE_ROLE_KEY` aus `supabase status -o env` setzen, dann `node scripts/real-stack/api.mjs`, `journey.mjs` (mit `SHOTS_DIR`) und `session.mjs`.
6. `modules.mjs` (braucht zusätzlich `CRON_SECRET`, läuft `modules-admin.mjs` mit) prüft jedes Modul über die API; `ui.mjs` (mit `SHOTS_DIR`) klickt alle Seiten im Handy-Viewport durch und legt Screenshots ab. Der Server braucht `VERCEL_ENV=development`, sonst sperrt der Rate-Limiter ohne Upstash.
7. `fuzz.mjs` (zieht `fuzz-access.mjs` und `fuzz-races.mjs` nach) schickt kaputte Bodies, fremde IDs, IDOR- und Race-Versuche gegen jede Schreibroute; `ui-edit.mjs` (mit `SHOTS_DIR`) klickt Action-Sheets, Bearbeiten, Löschen, Einstellungen und Dark Mode durch; `discover.mjs` listet die Bedienelemente je Seite.

Die Skripte erwarten die lokalen Standardschlüssel von `supabase start`.

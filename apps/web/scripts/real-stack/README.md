# Echt-Test gegen lokalen Supabase-Stack

Prüft Anmeldung, Mails, Einladungen, Ausgaben, Putzplan, Chat, Übernahme, Konto löschen und Sitzungs-Erneuerung gegen echtes Supabase und echtes Postgres statt Fixtures.

1. `supabase init` in einem Wegwerf-Ordner, dort `supabase-config.toml` als `supabase/config.toml` einsetzen und die Vorlagen aus `supabase/templates/` nach `tpl/` kopieren.
2. `supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor`
3. Migrationen in Journal-Reihenfolge per `psql -f` einspielen (`db:migrate` verlangt Port 5432).
4. App im Produktionsmodus bauen und auf Port 3140 starten. Alle Variablen aus `.env.local` leeren oder auf lokale Werte setzen, sonst trifft der Lauf Prod-Dienste.
5. `node scripts/real-stack/api.mjs`, `journey.mjs` (mit `SHOTS_DIR`) und `session.mjs`.

Die Skripte erwarten die lokalen Standardschlüssel von `supabase start`.

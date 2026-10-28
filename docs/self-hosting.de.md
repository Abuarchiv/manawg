# ManaWG selbst hosten

English version: [self-hosting.md](self-hosting.md)

Die meisten Haushalte brauchen das nicht: [app.manawg.com](https://app.manawg.com) ist kostenlos
und braucht keine Einrichtung. Hoste selbst, wenn du die Daten auf einem Rechner haben willst, den
du kontrollierst.

Es gibt zwei Wege:

- **[Docker](#docker)** (empfohlen): Eine `compose.yaml` startet die App, PostgreSQL, die Anmeldung
  und den Bildspeicher auf jedem Rechner mit Docker, vom Laptop bis zum kleinen Server. Keine
  externen Konten nötig, außer einem SMTP-Anbieter für eine öffentliche Instanz.
- **[Vercel und Supabase](#vercel-und-supabase)**: Die App läuft auf Vercel, dazu kommt ein
  Supabase-Projekt, beides im kostenlosen Tarif.

## Docker

### Schnellstart

Du brauchst Docker mit Compose v2 (Docker Desktop, OrbStack oder Docker Engine unter Linux), `git`
und `openssl`. Die laufende Instanz braucht etwa 500 MB Arbeitsspeicher; das Bauen des App-Images
braucht einmalig etwa 3 GB.

```sh
git clone https://github.com/Abuarchiv/manawg-app.git
cd manawg-app
./docker/setup.sh
docker compose up -d
```

`setup.sh` erstellt `.env` aus [`.env.example`](../.env.example) mit frischen Geheimnissen. Beim
ersten Start lädt Docker die Images für Datenbank, Anmeldung und Speicher herunter, baut das
App-Image aus deinem Checkout (etwa zehn Minuten, weil noch kein App-Image veröffentlicht ist) und
richtet die Datenbank ein. Öffne danach [http://localhost](http://localhost) und lege ein Konto an.
Jede Mail, auch die Anmeldecodes, landet in Mailpit unter [http://localhost:8025](http://localhost:8025).

`docker compose ps` listet die Dienste auf; `setup` ist mit Code 0 beendet, die anderen laufen.
Wenn Port 80 belegt ist, setze in `.env` `HTTP_PORT=8080` und `APP_URL=http://localhost:8080` und
starte noch einmal mit `docker compose up -d`.

Während des Bauens meldet Compose, dass es `ghcr.io/abuarchiv/manawg-app` nicht laden kann; das ist
erwartet. Sobald ein Image für `MANAWG_VERSION` veröffentlicht ist, lädt Compose es stattdessen
herunter, und der erste Start dauert nur ein bis zwei Minuten.

Um die ganze Instanz zu prüfen, führe `./docker/smoke.sh` aus. Das Skript legt ein Testkonto an,
erstellt eine WG, lädt ein Bild hoch, ruft die geplanten Jobs auf und sichert und stellt die Daten
wieder her. Die Testdaten bleiben dabei zurück, also nutze es auf einer lokalen Instanz, nicht auf
einer, die Leute verwenden.

### Was läuft

| Dienst | Image | Aufgabe |
| --- | --- | --- |
| `app` | `ghcr.io/abuarchiv/manawg-app` | Die Next.js-App |
| `db` | `supabase/postgres` | PostgreSQL mit den Rollen, die Auth und Storage erwarten |
| `auth` | `supabase/gotrue` | Konten, Anmeldecodes, Mailbestätigung, Google-Anmeldung |
| `storage` | `supabase/storage-api` | Private Bilder von Belegen und Ankündigungen, auf einem Volume gespeichert |
| `gateway` | `caddy` | Der einzige veröffentlichte Port: die App plus die wenigen Auth- und Storage-Routen, die ein Browser braucht, HTTPS für eine Domain |
| `setup` | App-Image | Läuft bei jedem Start und beendet sich dann: Migrationen, Datenbankrolle, Storage-Bucket, Mailvorlagen. Alle Schritte sind idempotent |
| `cron` | App-Image | Ruft die geplanten Jobs aus `apps/web/vercel.json` auf (UTC) |
| `mailpit` | `axllent/mailpit` | Fängt lokal alle Mails ab (Profil `mailpit`) |

Die Daten liegen in den Volumes `db-data` (Datenbank) und `storage-data` (Bilder). `docker compose down`
lässt sie bestehen; `docker compose down -v` löscht sie.

### Öffentliche Instanz mit Domain

1. Ein Server mit Docker, ein DNS-Eintrag deiner Domain, der darauf zeigt, und offene Ports 80 und
   443.
2. Erstelle die Konfiguration für die Domain:

   ```sh
   ./docker/setup.sh wg.example.com
   ```

   Das setzt `APP_URL=https://wg.example.com` und `SITE_ADDRESS=wg.example.com` und schaltet
   Mailpit ab. Caddy holt beim ersten Start ein Let's-Encrypt-Zertifikat.
3. Trage in `.env` das SMTP-Konto ein (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) und
   verwende in `SMTP_ADMIN_EMAIL` eine Absenderadresse, die dein Anbieter akzeptiert. Jeder
   SMTP-Anbieter funktioniert, viele haben einen kostenlosen Tarif, der für einen Haushalt reicht.
   Die Anmeldung braucht Mail, deshalb ist das Pflicht.
4. Setze `LEGAL_URL` und `SUPPORT_EMAIL` (siehe [Rechtliche Seiten und Support](#rechtliche-seiten-und-support)).
5. Starte es:

   ```sh
   docker compose up -d
   ```

Wenn du stattdessen hinter einem eigenen Reverse Proxy läufst, lass `SITE_ADDRESS=:80`, setze
`HTTP_PORT` auf einen lokalen Port und `TRUSTED_PROXIES` auf die Adresse des Proxys
(`private_ranges` deckt Proxys auf demselben Host oder im selben Netzwerk ab) und lass den Proxy
`Host` und `X-Forwarded-Proto` weitergeben. `APP_URL` ist immer die Adresse, die die Leute öffnen.

- `TRUSTED_PROXIES` muss den Proxy enthalten. Sonst ignoriert das Gateway die Client-Adresse, die
  der Proxy schickt, und die Ratenbegrenzungen der App, etwa für die Anmeldung, gelten für alle
  Besucher gemeinsam.
- Caddy lauscht mit `SITE_ADDRESS=:80` nicht auf 443, der Host-Port bleibt aber belegt. Gehört 443
  schon einem anderen Dienst, setze `HTTPS_PORT` auf einen freien Port.
- Mit `HTTP_BIND=127.0.0.1:` (den Doppelpunkt am Ende behalten) ist das Gateway nur von diesem
  Host aus erreichbar, niemand kann den Proxy umgehen. Läuft der Proxy in einem anderen Container
  oder auf einem anderen Host, lass den Standardwert.

### Konfiguration

Jede Einstellung steht in `.env` und ist in [`.env.example`](../.env.example) beschrieben. Führe
nach einer Änderung `docker compose up -d` aus; `docker compose restart` liest `.env` nicht neu
ein.

| Einstellung | Pflicht | Wirkung |
| --- | --- | --- |
| `APP_URL`, `SITE_ADDRESS` | ja | Adresse der Instanz und das, was das Gateway ausliefert |
| `SMTP_*` | ja | Ausgehende Mail für Anmeldecodes, Einladungen und Abrechnungen |
| Geheimnisse (`POSTGRES_PASSWORD` … `CRON_SECRET`) | ja | Von `setup.sh` erzeugt. `ANON_KEY` und `SERVICE_ROLE_KEY` sind mit `JWT_SECRET` signiert; ändere alle drei zusammen |
| `LEGAL_URL`, `SUPPORT_EMAIL` | für öffentliche Instanzen | Deine rechtlichen Seiten und die Adresse für Fehlermeldungen |
| `MANAWG_VERSION` | nein | Image-Tag, der läuft; `latest` ist das neueste veröffentlichte Image |
| `GOOGLE_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET` | nein | Google-Anmeldung mit deinem eigenen OAuth-Client; Redirect-URI `<APP_URL>/auth/v1/callback`. Standardmäßig aus, die App zeigt dann keine Google-Buttons |
| `VAPID_*` | nein | Push-Benachrichtigungen, siehe unten |

Optionale Funktionen bleiben ohne ihre Einstellungen aus, die App läuft trotzdem weiter:

- **Push-Benachrichtigungen:** Der öffentliche VAPID-Schlüssel wird in den Browsercode eingebaut,
  deshalb ist Push im veröffentlichten Image abgeschaltet. Erzeuge Schlüssel mit
  `npx web-push generate-vapid-keys`, setze `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` und
  `VAPID_SUBJECT` (`mailto:you@example.com`) und baue dann mit `docker compose up -d --build` dein
  eigenes Image.
- **Rate Limiting** läuft im Speicher der App. Das reicht für einen App-Container; Upstash Redis
  ist nicht nötig.
- **Fehlerberichte und Produktanalyse** (Sentry, PostHog) sind aus.

`/api/health` zeigt unter `degradedFeatures`, was abgeschaltet ist; `docker compose logs app` zeigt
die Startzeilen, die mit `[env]` beginnen.

### Aktualisieren

Mach zuerst ein Backup (`./docker/backup.sh`). Wenn Compose das Image aus deinem Checkout gebaut
hat:

```sh
git pull
docker compose up -d --build
```

Bei einem veröffentlichten Image (`MANAWG_VERSION`) nimmst du stattdessen
`docker compose pull && docker compose up -d`. Der Dienst `setup` wendet neue Migrationen an, bevor
die neue App-Version startet. Eine Änderung, die bei selbst gehosteten Instanzen einen manuellen
Schritt braucht, sagt das in ihrem Pull Request; lies vor dem Update die Liste der Änderungen
(`git fetch && git log --oneline HEAD..origin/main` im Checkout, bei einem veröffentlichten Image
die Commit-Historie auf GitHub).

Migrationen laufen nur vorwärts und werden nie zurückgenommen. Willst du zurück, checke den alten
Commit oder Tag aus (bei einem veröffentlichten Image setzt du `MANAWG_VERSION` auf den alten Tag).
Baust du aus dem Quellcode, führe danach `docker compose build` aus, denn das lokale Image ist noch
der neue Build. Stelle dann das Backup, das du vor dem Update gemacht hast, mit
`./docker/restore.sh` wieder her.
Eine ältere Version auf einer schon migrierten Datenbank zu starten, wird nicht unterstützt.

Um `MEMBER_SESSION_SECRET` zu wechseln, kopiere den alten Wert nach `MEMBER_SESSION_SECRET_PREVIOUS`,
trage in `MEMBER_SESSION_SECRET` einen neuen ein und führe `docker compose up -d` aus. Mit dem
alten Secret signierte Kalender-Feed-URLs und Abmeldelinks funktionieren weiter; entferne den alten
Wert später wieder.

Container-Logs werden rotiert (drei Dateien mit je 10 MB pro Container) und füllen die Platte nicht.

### Backup und Wiederherstellung

```sh
./docker/backup.sh                                         # backups/manawg-<UTC time>.tar.gz
./docker/restore.sh backups/manawg-20261028-031500.tar.gz  # replaces this instance's data
```

Das Archiv enthält die Datenbank (App, Konten, Storage-Metadaten) und alle Bilder. Die
Wiederherstellung funktioniert auch auf einem frischen Rechner, nach `./docker/setup.sh`.
Zeitplan, Verschlüsselung und das Prüfen einer Wiederherstellung stehen in
[Backup und Wiederherstellung](database-recovery.md#docker).

## Vercel und Supabase

Alles passt in die kostenlosen Tarife der beteiligten Dienste. Der Hobby-Tarif von Vercel ist für
nicht kommerzielle Nutzung, und Supabase pausiert kostenlose Projekte nach einer Zeit ohne Aktivität
(setze sie im Dashboard fort). Plane für die erste Einrichtung etwa eine Stunde ein.

### Was du brauchst

| Dienst | Wofür | Pflicht |
| --- | --- | --- |
| [Supabase](https://supabase.com) | PostgreSQL, Auth, Bildspeicher | ja |
| [Vercel](https://vercel.com) | Hosting und Cron-Jobs | ja |
| [Upstash Redis](https://upstash.com) | Rate Limiting; API-Routen schlagen auf Vercel ohne es geschlossen fehl | ja |
| Ein SMTP-Anbieter, z. B. [Resend](https://resend.com) | Anmeldecodes und Bestätigungsmails von Supabase Auth, Mails, die die App verschickt | ja |
| Web-Push-Schlüssel, Sentry | Push-Benachrichtigungen, Fehlerberichte | nein |

Lokal brauchst du Node 22, pnpm 9 (`corepack enable`) und `openssl`.

### 1. Code holen

Forke das Repository auf GitHub (damit Vercel es deployen kann und du Updates übernehmen kannst),
klone dann deinen Fork und installiere:

```sh
git clone https://github.com/<you>/manawg-app.git
cd manawg-app
pnpm install
```

### 2. Supabase-Projekt anlegen

1. Lege ein Projekt in der Region an, die deinen Nutzern am nächsten liegt.
2. Notiere unter **Project Settings** die Projekt-URL (**Data API**) und unter **API Keys** den
   Publishable Key und einen Secret Key.
3. Notiere unter **Connect** zwei Verbindungs-Strings:
   - den **Transaction Pooler** (Port `6543`) für die laufende App,
   - den **Session Pooler** (Port `5432`) für Migrationen. Die direkte Verbindung
     (`db.<ref>.supabase.co:5432`) funktioniert auch, aber nur über IPv6, solange du nicht das
     IPv4-Add-on von Supabase dazubuchst.

#### Datenbankrolle für den Betrieb

Die App sollte sich nicht als `postgres` verbinden. Lege eine Rolle an, die Zeilen lesen und
schreiben, aber das Schema nicht ändern kann. Im **SQL Editor** von Supabase, bevor du die
Migrationen ausführst:

```sql
create role manawg_app login bypassrls password '<long random password>';
```

Die Migration `0034_app_role_grants` gibt dieser Rolle Zugriff auf jede Tabelle, auch auf künftige.
Die Laufzeit-URL der App nutzt dann diese Rolle über den Transaction Pooler:

```text
postgresql://manawg_app.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

`bypassrls` ist Absicht: Der Server prüft bei jeder Anfrage die WG-Mitgliedschaft, und Row Level
Security ist eine zweite Schutzebene, die direkten Zugriff über die Supabase Data API blockiert.

### 3. Migrationen anwenden

```sh
export DATABASE_MIGRATION_URL='postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require'
pnpm --filter @manawg/web db:migrate
pnpm --filter @manawg/web db:check
```

Der Migrator akzeptiert nur Supabase-Session-Verbindungen auf Port `5432` und liest keine
`.env`-Dateien. `db:check` prüft das Schema, das Migrationsprotokoll und die Einrichtung von Row
Level Security.

### 4. Supabase Auth konfigurieren

Unter **Authentication → URL Configuration**:

- **Site URL**: die URL deiner App, z. B. `https://wg.example.com`.
- **Redirect URLs**: füge `https://wg.example.com/auth/callback` hinzu.

Aktiviere unter **Authentication → SMTP Settings** ein eigenes SMTP. Der eingebaute Maildienst von
Supabase liefert nur an Mitglieder deines Supabase-Teams aus und ist ratenbegrenzt, echte Nutzer
würden ihren Anmeldecode also nie bekommen.

Spiel danach die ManaWG-Mailvorlagen ein. Dieser Schritt ist Pflicht: Er setzt auch die Länge des
Anmeldecodes auf 8 Ziffern, die das Anmeldeformular erwartet. Erstelle ein Personal Access Token
unter [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens):

```sh
SUPABASE_ACCESS_TOKEN=<token> node scripts/supabase-auth-templates.mjs \
  --ref <project-ref> \
  --app-url https://wg.example.com \
  --legal-url https://example.com \
  --apply
```

Führe es einmal ohne `--apply` aus, um zu sehen, was sich ändern würde. `--legal-url` ist die
Seite mit deinen rechtlichen Seiten (siehe [Rechtliche Seiten und Support](#rechtliche-seiten-und-support)).

Inhalt und Betreff der Mails wählen Deutsch oder Englisch anhand von `locale` in den
Benutzer-Metadaten des Kontos. Konten ohne `locale` bekommen Deutsch.

**Google-Anmeldung (optional):** Aktiviere den Google-Provider unter **Authentication → Providers**
mit deinem eigenen OAuth-Client. Die Redirect-URI, die du bei Google eintragen musst, wird dort
angezeigt. Ohne Google-Anmeldung setze `GOOGLE_SIGN_IN=false`, damit die App ihre Google-Buttons
ausblendet.

### 5. Bildspeicher

Lege einen Supabase-Storage-Bucket an, der **privat** ist, eine Dateigrößenbegrenzung von genau
**8 MiB** hat und genau `image/jpeg`, `image/png`, `image/webp`, `image/heic` und `image/heif`
erlaubt. Die App prüft diese Konfiguration und schaltet Uploads ab, wenn sie abweicht. Trage den
Namen des Buckets in `SUPABASE_STORAGE_BUCKET` ein.

### 6. Auf Vercel deployen

`apps/web/vercel.json` schaltet automatische Deployments von `main` ab. Passe in deinem Fork zuerst
zwei Einstellungen an:

- Lösche den Block `git` (`"deploymentEnabled": { "main": false }`). Sonst deployt Vercel Pushes auf
  `main` nicht, und du müsstest für jedes Update `vercel deploy --prod` ausführen.
- Setze `regions` auf die Vercel-Region, die deinem Supabase-Projekt am nächsten ist (`fra1` ist
  Frankfurt).

Danach:

1. **Add New → Project**, importiere deinen Fork und setze **Root Directory** auf `apps/web`.
   Framework, Install- und Build-Befehle kommen aus `apps/web/vercel.json`.
2. Füge die Umgebungsvariablen unten für **Production** hinzu.
3. Deploye.

Die Cron-Jobs in `vercel.json` laufen höchstens einmal am Tag, was der Hobby-Tarif erlaubt.

#### Umgebungsvariablen

Pflicht:

| Variable | Wert |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Die URL deiner App, z. B. `https://wg.example.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Projekt-URL von Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable Key von Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret Key von Supabase. Nur serverseitig; nötig für das Löschen von Konten und für Supabase Storage |
| `POSTGRES_URL` | Laufzeit-URL mit der Rolle `manawg_app` auf Port `6543` |
| `MEMBER_SESSION_SECRET` | `openssl rand -hex 32`; signiert Kalender-Feeds und Abmeldelinks |
| `MEMBER_SESSION_SECRET_PREVIOUS` | Optional. Der alte Wert, während du `MEMBER_SESSION_SECRET` wechselst; damit signierte Links bleiben gültig. Danach entfernen |
| `CRON_SECRET` | `openssl rand -hex 32`; Vercel schickt es an die Cron-Routen |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Aus deiner Upstash-Redis-Datenbank |
| `SUPABASE_STORAGE_BUCKET` | Siehe [Bildspeicher](#5-bildspeicher) |

Mail, die die App selbst verschickt (Einladungen, Monatsabrechnungen, Erinnerungen):

| Variable | Wert |
| --- | --- |
| `RESEND_API_KEY` | API-Key von Resend |
| `STATEMENT_EMAIL_FROM` | Absender auf einer Domain, die in deinem Resend-Konto verifiziert ist, z. B. `ManaWG <noreply@example.com>` |

Optional:

| Variable | Wirkung, wenn gesetzt |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push-Benachrichtigungen (`npx web-push generate-vapid-keys`; Subject `mailto:you@example.com`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Fehlerberichte an dein Sentry-Projekt |
| `NEXT_PUBLIC_LEGAL_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL` | Siehe [Rechtliche Seiten und Support](#rechtliche-seiten-und-support) |

Lass `NEXT_PUBLIC_POSTHOG_*` leer: Die Produktanalyse bleibt dann aus.
Jede Variable ist in [`apps/web/.env.example`](../apps/web/.env.example) beschrieben.

### 7. Deployment prüfen

- `https://wg.example.com/api/health` antwortet mit `200` und `"status":"ok"`.
- Das Funktionslog enthält `[env] all variables present`. Eine Zeile, die mit
  `[env] MISSING REQUIRED` beginnt, nennt, was fehlt; `[env] DEGRADED` nennt optionale Funktionen,
  die aus sind.
- Lege mit deiner E-Mail-Adresse ein Konto an, gib den 8-stelligen Code ein, erstelle eine WG und
  lade eine zweite Adresse ein.

### Auf Vercel aktualisieren

```sh
git remote add upstream https://github.com/Abuarchiv/manawg-app.git   # once
git pull upstream main
pnpm install
pnpm --filter @manawg/web db:migrate   # with DATABASE_MIGRATION_URL exported
git push
```

Wende die Migrationen an, bevor die neue Version live geht; der Push in deinen Fork deployt sie.
Behalte deine eigenen Änderungen an `vercel.json`, wenn der Pull dort einen Konflikt meldet. Eine
Änderung, die einen manuellen Schritt braucht, sagt das in ihrem Pull Request.

### Backups bei Supabase

Der kostenlose Supabase-Tarif hat keine automatischen Backups. Erstelle eigene, siehe
[Backup und Wiederherstellung](database-recovery.md#vercel-and-supabase).

## Rechtliche Seiten und Support

Das gilt für beide Wege. Bei Docker heißen die Einstellungen `LEGAL_URL` und `SUPPORT_EMAIL`.

- `NEXT_PUBLIC_LEGAL_URL` ist die Seite mit deinem `/impressum`, `/datenschutz` und `/agb`. Die App
  und ihre Mails verlinken dorthin. Ist sie nicht gesetzt, zeigen die Links auf manawg.com, dessen
  rechtliche Seiten deine Instanz nicht abdecken. Wenn du deine Instanz Leuten außerhalb deines
  eigenen Haushalts anbietest, brauchst du ein eigenes Impressum und eine eigene
  Datenschutzerklärung. Die Einstellung markiert die Instanz außerdem als selbst gehostet: Sie gibt
  sich gegenüber Suchmaschinen nicht als die offizielle App aus.
- Links zu "Über ManaWG", "Die WG-App" und "WG-Ratgeber" zeigen weiter auf manawg.com, die Seite
  des Projekts.
- `NEXT_PUBLIC_SUPPORT_EMAIL` erhält die Meldungen aus "Fehler per E-Mail melden". Bei Docker fällt
  ein leeres `SUPPORT_EMAIL` auf `SMTP_ADMIN_EMAIL` zurück. Auf Vercel gehen die Meldungen bei einem
  nicht gesetzten Wert an die ManaWG-Maintainer, die deine Instanz nicht sehen können, setze ihn
  dort also.

## Hilfe bekommen

Fragen gehören in die [Discussions](https://github.com/Abuarchiv/manawg-app/discussions), Fehler in
ein [Issue](https://github.com/Abuarchiv/manawg-app/issues/new/choose) mit den Startzeilen, die mit
`[env]` beginnen. Poste nie Geheimnisse, Verbindungs-Strings oder Schlüssel.

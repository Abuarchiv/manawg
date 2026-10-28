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
ersten Start lädt Docker die Images für Datenbank, Anmeldung und Speicher herunter, besorgt das
App-Image und richtet die Datenbank ein. Öffne danach [http://localhost](http://localhost) und lege ein Konto an.
Jede Mail, auch die Anmeldecodes, landet in Mailpit unter [http://localhost:8025](http://localhost:8025).

`docker compose ps` listet die Dienste auf; `setup` ist mit Code 0 beendet, die anderen laufen.
Wenn Port 80 belegt ist, setze in `.env` `HTTP_PORT=8080` und `APP_URL=http://localhost:8080` und
starte noch einmal mit `docker compose up -d`.

Compose lädt `ghcr.io/abuarchiv/manawg-app:<MANAWG_VERSION>` herunter, wenn es diesen Tag gibt.
Sonst baut es das Image aus deinem Checkout, was etwa zehn Minuten dauert; die Meldung, dass es das
Image nicht laden kann, ist dann harmlos.

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

`POSTGRES_PASSWORD` wird im Volume `db-data` festgelegt, wenn die Datenbank zum ersten Mal angelegt
wird. Geht `.env` verloren oder wird neu erzeugt, schlagen die Dienste mit
`password authentication failed` fehl. Bei einer Wegwerf-Instanz hilft `docker compose down -v` und
ein neuer Start. Bei einer Instanz mit Daten stelle die alte `.env` wieder her oder setze das neue
Passwort für die Rollen `postgres`, `supabase_auth_admin` und `supabase_storage_admin` (siehe
[Geheimnisse wechseln](#geheimnisse-wechseln)).

### Öffentliche Instanz mit Domain

1. Ein Server mit Docker, ein DNS-Eintrag deiner Domain, der darauf zeigt, und offene TCP-Ports
   80 und 443 (UDP 443 optional, für HTTP/3).
2. Erstelle die Konfiguration für die Domain:

   ```sh
   ./docker/setup.sh wg.example.com
   ```

   Das setzt `APP_URL=https://wg.example.com` und `SITE_ADDRESS=wg.example.com` und schaltet
   Mailpit ab. Caddy holt beim ersten Start ein Let's-Encrypt-Zertifikat. Existiert `.env` schon,
   ändert `setup.sh` nichts und listet die Schlüssel auf, die du selbst anpassen musst: `APP_URL`,
   `SITE_ADDRESS`, `COMPOSE_PROFILES`, `SMTP_HOST`, `SMTP_PORT` und `SMTP_ADMIN_EMAIL`.
3. Trage in `.env` das SMTP-Konto ein (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) und
   verwende in `SMTP_ADMIN_EMAIL` eine Absenderadresse, die dein Anbieter akzeptiert. Jeder
   SMTP-Anbieter funktioniert, viele haben einen kostenlosen Tarif, der für einen Haushalt reicht.
   Die Anmeldung braucht Mail, deshalb ist das Pflicht: `docker compose up` bricht ab, solange
   `SMTP_HOST` leer ist. Setze Werte, die `$` oder `#` enthalten, in einfache Anführungszeichen.
4. Setze `LEGAL_URL` und `SUPPORT_EMAIL` (siehe [Rechtliche Seiten und Support](#rechtliche-seiten-und-support)).
5. Starte es:

   ```sh
   docker compose up -d
   ```

Jede Adresse außer `localhost` braucht HTTPS, entweder eine Domain mit Let's Encrypt wie oben oder
einen Reverse Proxy, der TLS beendet. Passwort-Zurücksetzen, der Service Worker und das Installieren
der App setzen einen sicheren Kontext voraus. `SITE_ADDRESS=:80` ist für `http://localhost` und für
den Betrieb hinter einem solchen Proxy gedacht, nicht dafür, eine Adresse im lokalen Netz
auszuliefern.

Die Registrierung steht allen offen, die die URL erreichen. Die Ratenbegrenzungen und die
Mailbestätigung begrenzen Missbrauch; abschalten lässt sich die Registrierung nicht, weil
eingeladene Mitglieder ihr Konto selbst anlegen. Für eine Instanz nur für den eigenen Haushalt
schränke den Zugriff am Proxy ein (VPN, IP-Allowlist, Basic Auth).

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
| `SMTP_*` | ja | Ausgehende Mail für Anmeldecodes, Einladungen und Abrechnungen; `SMTP_ADMIN_EMAIL` ist die Absenderadresse und `SMTP_SENDER_NAME` ihr Anzeigename |
| Geheimnisse (`POSTGRES_PASSWORD` … `CRON_SECRET`) | ja | Von `setup.sh` erzeugt. `ANON_KEY` und `SERVICE_ROLE_KEY` sind mit `JWT_SECRET` signiert; ändere alle drei zusammen |
| `LEGAL_URL`, `SUPPORT_EMAIL` | für öffentliche Instanzen | Deine rechtlichen Seiten und die Adresse für Fehlermeldungen, siehe [Rechtliche Seiten und Support](#rechtliche-seiten-und-support) |
| `MANAWG_VERSION` | nein | Image-Tag, der läuft; Compose lädt ihn herunter, wenn es ihn gibt, und baut sonst aus dem Checkout |
| `MANAWG_IMAGE` | nein | Image-Repository, Standard `ghcr.io/abuarchiv/manawg-app`; für einen Fork oder eine private Registry |
| `STORAGE_BUCKET` | nein | Name des Bildspeicher-Buckets, Standard `private-images`. Ändere ihn nach dem ersten Start nicht |
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
`docker compose pull && docker compose up -d`. Läuft die neue Version, entferne mit
`docker image prune -f` die alten Images und optional mit `docker builder prune` den Build-Cache.
Beides lässt Volumes unberührt.

Der Dienst `setup` wendet neue Migrationen an, bevor die neue App-Version startet. Eine Änderung, die bei selbst gehosteten Instanzen einen manuellen
Schritt braucht, sagt das in ihrem Pull Request; lies vor dem Update die Liste der Änderungen
(`git fetch && git log --oneline HEAD..origin/main` im Checkout, bei einem veröffentlichten Image
die Commit-Historie auf GitHub).

Migrationen laufen nur vorwärts und werden nie zurückgenommen. Willst du zurück, checke den alten
Commit oder Tag aus (bei einem veröffentlichten Image setzt du `MANAWG_VERSION` auf den alten Tag).
Baust du aus dem Quellcode, führe danach `docker compose build` aus, denn das lokale Image ist noch
der neue Build. Stelle dann das Backup, das du vor dem Update gemacht hast, mit
`./docker/restore.sh` wieder her.
Eine ältere Version auf einer schon migrierten Datenbank zu starten, wird nicht unterstützt.

Container-Logs werden rotiert (drei Dateien mit je 10 MB pro Container) und füllen die Platte nicht.

### Geheimnisse wechseln

- `MEMBER_SESSION_SECRET`: Kopiere den alten Wert nach `MEMBER_SESSION_SECRET_PREVIOUS`, trage in
  `MEMBER_SESSION_SECRET` einen neuen ein und führe `docker compose up -d` aus. Mit dem alten
  Secret signierte Kalender-Feed-URLs und Abmeldelinks funktionieren weiter; entferne den alten
  Wert später wieder.
- `JWT_SECRET`: Leere `JWT_SECRET`, `ANON_KEY` und `SERVICE_ROLE_KEY` in `.env`, führe
  `./docker/setup.sh` aus, um neue zu erzeugen, und danach `docker compose up -d`. Alle Sitzungen
  enden, die Mitglieder melden sich neu an.
- `MANAWG_APP_DB_PASSWORD`: Trage in `.env` einen neuen Wert ein und führe `docker compose up -d`
  aus; der Dienst `setup` setzt ihn bei der Rolle.
- `POSTGRES_PASSWORD`: Ändere das Passwort zuerst in der Datenbank, dann in `.env`, und führe dann
  `docker compose up -d` aus.

  ```sh
  docker compose exec db psql -U supabase_admin -d postgres \
    -c "ALTER USER postgres WITH PASSWORD '<neues Passwort>'" \
    -c "ALTER USER supabase_auth_admin WITH PASSWORD '<neues Passwort>'" \
    -c "ALTER USER supabase_storage_admin WITH PASSWORD '<neues Passwort>'"
  ```

  Nimm nur Buchstaben und Ziffern (`openssl rand -hex 24`), dann bleibt das Quoting einfach.

### Backup und Wiederherstellung

```sh
./docker/backup.sh                                         # backups/manawg-<UTC-Zeit>.tar.gz
./docker/restore.sh backups/manawg-20261028-031500.tar.gz  # ersetzt die Daten dieser Instanz
```

Das Archiv enthält die Datenbank (App, Konten, Storage-Metadaten) und alle Bilder. Die
Wiederherstellung funktioniert auch auf einem frischen Rechner, nachdem du deine alte `.env`
kopiert hast (eine neue `.env` macht bestehende Kalender-Feed- und Abmeldelinks ungültig).
Zeitplan, Verschlüsselung und das Prüfen einer Wiederherstellung stehen in
[Backup und Wiederherstellung](database-recovery.md#docker) (englisch).

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
git clone https://github.com/<dein-name>/manawg-app.git
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
create role manawg_app login bypassrls password '<langes-zufälliges-passwort>';
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

Führe es einmal ohne `--apply` aus, um zu sehen, was sich ändern würde. `--app-url` und
`--legal-url` sind Pflicht; `--legal-url` ist die Seite mit deinen rechtlichen Seiten (siehe
[Rechtliche Seiten und Support](#rechtliche-seiten-und-support)).

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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Ein SMTP-Konto statt Resend; dasselbe Konto wie in Supabase Auth funktioniert. Ist `SMTP_HOST` gesetzt, hat es Vorrang vor `RESEND_API_KEY`. `SMTP_PORT` ist standardmäßig `587` |
| `STATEMENT_EMAIL_FROM` | Absender, z. B. `ManaWG <noreply@example.com>`. Bei Resend eine Domain, die in deinem Konto verifiziert ist; bei SMTP eine Adresse, die dein Anbieter akzeptiert |

Optional:

| Variable | Wirkung, wenn gesetzt |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push-Benachrichtigungen (`npx web-push generate-vapid-keys`; Subject `mailto:you@example.com`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Fehlerberichte an dein Sentry-Projekt |
| `GOOGLE_SIGN_IN` | `false` blendet die Google-Buttons aus. Setze es, wenn du den Google-Provider nicht aktiviert hast (siehe [Schritt 4](#4-supabase-auth-konfigurieren)); ungesetzt werden sie angezeigt |
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
git remote add upstream https://github.com/Abuarchiv/manawg-app.git   # einmalig
git pull upstream main
pnpm install
pnpm --filter @manawg/web db:migrate   # mit exportiertem DATABASE_MIGRATION_URL
git push
```

Wende die Migrationen an, bevor die neue Version live geht; der Push in deinen Fork deployt sie.
Behalte deine eigenen Änderungen an `vercel.json`, wenn der Pull dort einen Konflikt meldet. Eine
Änderung, die einen manuellen Schritt braucht, sagt das in ihrem Pull Request.

### Backups bei Supabase

Der kostenlose Supabase-Tarif hat keine automatischen Backups. Erstelle eigene, siehe
[Backup und Wiederherstellung](database-recovery.md#vercel-and-supabase) (englisch).

## Zeitzone

Tages- und Monatsgrenzen, Fälligkeiten von Aufgaben, wiederkehrende Einträge, Erinnerungen und
Ruhezeiten richten sich nach der Wanduhr von Europe/Berlin, unabhängig von der Zeitzone, in der der
Server läuft. Das ist nicht einstellbar. Siehe die
[Architekturnotizen](architecture.md#decisions-on-trust-retention-and-exposure) (englisch).

## Rechtliche Seiten und Support

Das gilt für beide Wege. Bei Docker heißen die Einstellungen `LEGAL_URL` und `SUPPORT_EMAIL`.

- `NEXT_PUBLIC_LEGAL_URL` ist die Seite mit deinem `/impressum`, `/datenschutz` und `/agb`. Ist sie
  nicht gesetzt, zeigt die Instanz in der App und in Mails keine rechtlichen Links und keine
  Einwilligungslinks. Setze sie, bevor jemand anderes die Instanz nutzt: Wenn du deine Instanz
  Leuten außerhalb deines eigenen Haushalts anbietest, brauchst du ein eigenes Impressum und eine
  eigene Datenschutzerklärung. Jede Instanz außer der offiziellen (`app.manawg.com`) gilt als
  selbst gehostet und gibt sich gegenüber Suchmaschinen nicht als die offizielle App aus; das hängt
  nicht von `LEGAL_URL` ab.
- Links zu "Über ManaWG", "Die WG-App" und "WG-Ratgeber" zeigen weiter auf manawg.com, die Seite
  des Projekts.
- `NEXT_PUBLIC_SUPPORT_EMAIL` erhält die Meldungen aus "Fehler per E-Mail melden". Bei Docker fällt
  ein leeres `SUPPORT_EMAIL` auf `SMTP_ADMIN_EMAIL` zurück. Auf Vercel blendet ein nicht gesetzter
  Wert die Melde-Links aus.

## Fehlersuche

Für das Docker-Setup. Auf Vercel beginne mit [Deployment prüfen](#7-deployment-prüfen).

| Symptom | Was tun |
| --- | --- |
| `setup` wurde mit einem Fehler beendet | `docker compose logs setup` zeigt den Schritt, der fehlgeschlagen ist |
| Der Build bricht mit Exit-Code 137 ab | Dem Rechner ging der Arbeitsspeicher aus. Richte Swap ein oder baue auf einem größeren Rechner |
| Kein Zertifikat für die Domain | Prüfe, ob der DNS-Eintrag auf den Server zeigt und die TCP-Ports 80 und 443 erreichbar sind, und lies dann `docker compose logs gateway` |
| Kein Anmeldecode kommt an | `docker compose logs auth` zeigt den SMTP-Fehler. Prüfe die `SMTP_*`-Einstellungen und den Absender in `SMTP_ADMIN_EMAIL`; lokal schau in Mailpit |
| Ein Port ist schon belegt | Setze `HTTP_PORT` (siehe [Schnellstart](#schnellstart)) oder `HTTPS_PORT` (siehe [Öffentliche Instanz mit Domain](#öffentliche-instanz-mit-domain)) |
| `password authentication failed` | `.env` passt nicht zum Datenbank-Volume, siehe [Was läuft](#was-läuft) |

## Hilfe bekommen

Fragen gehören in die [Discussions](https://github.com/Abuarchiv/manawg-app/discussions), Fehler in
ein [Issue](https://github.com/Abuarchiv/manawg-app/issues/new/choose) mit den Startzeilen, die mit
`[env]` beginnen. Bei einer Docker-Instanz füge die Ausgabe von `docker compose ps` und die Logs
des fehlerhaften Dienstes (`docker compose logs <Dienst>`) bei. Entferne vorher Geheimnisse,
Verbindungs-Strings und Schlüssel und poste sie nie.

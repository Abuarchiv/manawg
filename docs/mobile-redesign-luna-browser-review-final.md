# ManaWG Mobile Redesign — finaler Browser-Review

Datum: 2026-09-05
Reviewziel: phone-only UI nach der shadcn/ui- und Animate-UI-Migration.

## Ausführung

- Runtime: Node 22.23.2, Next.js 15.5.24, gebaute Fixture-Runtime aus .next-e2e-3120
- Browser: isoliertes headless Chromium via Playwright; kein persönliches Chrome-Profil
- Server: lokaler http://localhost:3232, E2E_FIXTURE_MODE=true, NEXT_PUBLIC_E2E_FIXTURE_MODE=true, NEXT_PUBLIC_DB_DOWN=true, leere Datenbank-/Provider-Variablen
- Identität: nur Fixture-WG MTE8PZAT und Fixture-Mitglied dsaf; keine Credentials und keine Hosted-/Produktionsdaten
- Zustände: 390x844 Light, 320x844 Light, 390x844 Dark; isMobile=true, hasTouch=true, reducedMotion=reduce
- Route-Matrix: Start, Einkauf, Putzen, Kalender, Ausgaben, Fixkosten, Mahnungen, Import, Pinnwand, Chat, Suche und Einstellungen

## Klicknachweis

Auf 390px und 320px wurde die Shell tatsächlich bedient:

Start → Haushalt (/einkauf) → Finanzen (/ausgaben) → Austausch (/pinnwand) → Start

Jeder Schritt änderte die URL korrekt und setzte aria-current="page" auf den aktiven Navigationseintrag.

Zusätzlich wurden sicher und reversibel geöffnet/geschlossen:

- Pinnwand-Composer (Beitrag erstellen → Neuer Beitrag → Beitrag abbrechen)
- Ausgabenformular (Ausgabe erfassen → Ausgabe abbrechen)
- Kalenderformular (Termin erstellen → Escape)
- Einstellungen-Tabs: Profil, Benachrichtigungen, Zugang und Daten

Ein separater Luna-High-Playwright-Smoke-Lauf für Shell und Chat bestand mit 3/3 Chromium-Tests in 50,9 Sekunden.

Die datenabhängigen Einkaufs-/Putz-Drawer sowie Pinnwand-Kommentar-/Aktionszustände waren im direkt gestarteten Build wegen der initialen Fixture-Mitgliedschafts-401-Antwort nicht mit Einträgen befüllt. Sie sind separat durch die Playwright-Fixture-Suites mit echten Einträgen und Klicks abgedeckt: Chores 35/35, Shopping Actions 15/15, Pinnwand 28/28, Settings Access 22/22.

## Messwerte

- Alle 23 geladenen Route-Zustände renderten ok=true mit sichtbarer Überschrift.
- document.documentElement.scrollWidth - clientWidth: 0px für jede geprüfte Breite und jeden Theme-Zustand.
- Keine pageerror-Ausnahmen.
- Ein Zum-Ende-scrollen-Element wurde im inaktiven Message-Scroller mit 42px Transform-Box gemessen (data-active=false, scale-95); seine CSS-Mindesthöhe/-breite ist 44px und es ist in diesem Zustand nicht aktiv/klickbar. Kein aktives Touchziel unter 44px festgestellt.
- Screenshots: 18 Matrix-Dateien plus 390-light-start-smoke.png und 390-light-chat-hitbox.png unter docs/mobile-redesign-luna-browser-review-final-assets/.

## Console-/Network-Befunde

Erwartete lokale Fixture-Degradationen:

- 401 für initiale Members-/Feature-Requests ohne produktive Mitgliedsdaten
- fehlende Datenbank bei absichtlich leerem POSTGRES_URL/DATABASE_URL
- optionale Speed-Insights-Route liefert lokal 404 bzw. MIME-/aborted-Noise
- abgebrochene RSC-Requests durch schnelle Navigation

Keine React-Exceptions, keine unerwarteten Redirects und kein produktiver/externer Datenzugriff im Review.

## Ergebnis und Risiken

Die mobile Struktur ist in den geprüften Zuständen ohne horizontales Clipping, die vier primären Bereiche sind direkt erreichbar, und die zentralen Form-/Overlay-Flows sind keyboard-/touchbedienbar. Die Ausführung ist ein automatisierter Fixture-Review, keine Studie mit Jugendlichen und kein Hosted-/Production-Nachweis. Provider-Integration, echte Account-Mitgliedschaft, Push, Uploads und Produktionsdaten bleiben außerhalb dieses lokalen Reviews.

Screenshots:

- 390-light-start-direct.png, 390-light-shopping-direct.png, 390-light-chores-direct.png, 390-light-expenses-direct.png
- 390-light-board-direct.png, 390-light-chat-direct.png, 390-light-settings-direct.png
- 320-light-start-direct.png, 320-light-shopping-direct.png, 320-light-chores-direct.png, 320-light-expenses-direct.png
- 320-light-board-direct.png, 320-light-chat-direct.png, 320-light-settings-direct.png
- 390-dark-start-direct.png, 390-dark-expenses-direct.png, 390-dark-board-direct.png, 390-dark-settings-direct.png
- 390-light-start-smoke.png und 390-light-chat-hitbox.png als fokussierte Runtime-Captures

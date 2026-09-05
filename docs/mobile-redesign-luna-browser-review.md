# Luna High: mobile Browserabnahme ManaWG-Redesign

Stand: 2026-09-05
Scope: ausschließlich lokaler Fixture-Server auf `http://localhost:3101`; Fixture-WG `MTE8PZAT`; kein echter Account, keine Einladung, keine Zahlung, keine Produktions-URL.

## Finaler Status

Die Abnahme wurde sicher beendet, bevor weitere Zustände erzeugt wurden. Sie lief über einen isolierten lokalen Playwright-Chromium-Kontext, weil der zunächst verbundene In-App-Browser für diesen lokalen Ursprung keinen `localStorage`-Fixture-Seed bereitgestellt hat. Die Fixture-Identität war ausschließlich die bestehende Testidentität (`dsaf`/`MTE8PZAT`). AX-/ARIA-Snapshots wurden als primäre Zustandsbeobachtung erfasst; Screenshots liegen unter [mobile-redesign-luna-browser-review-assets](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets).

## Erster belegter Lauf: 390×844, Light, Reduced Motion

Durchgeführt:

- `http://localhost:3101/wg/MTE8PZAT` geladen; sichtbarer Zustand: „Start“, Saldo 32,90 €, Module Ausgaben/Einkauf/Putzen/Pinnwand, vier Bottom-Destinations.
- Bottom-Navigation `Haushalt` → `/wg/MTE8PZAT/einkauf`.
- Bottom-Navigation `Finanzen` → `/wg/MTE8PZAT/ausgaben`.
- Bottom-Navigation `Austausch` → `/wg/MTE8PZAT/pinnwand`.
- Bottom-Navigation `Start` → `/wg/MTE8PZAT`.
- AX bestätigt benannte Navigationen und die `Module`-Region; kein Sammel- oder Schnellzugriffsmenü sichtbar.

Screenshots:

- [390-light-start.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-start.png)
- [390-light-pinnwand.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-pinnwand.png)
- [390-light-shopping.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-shopping.png)
- [390-light-chores.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-chores.png)
- [390-light-calendar.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-calendar.png)
- [390-light-expenses.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-expenses.png)
- [390-light-abos.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-abos.png)
- [390-light-debts.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-debts.png)
- [390-light-import.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-import.png)
- [390-light-board.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-board.png)
- [390-light-chat.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-chat.png)
- [390-light-settings.png](/Users/abu/Company/manawg-app-mobile-redesign/docs/mobile-redesign-luna-browser-review-assets/390-light-settings.png)

Beobachtete lokale Netzwerk-/Konsoleinträge im ersten Lauf:

- `401` auf `/api/wg/MTE8PZAT/members` und `/api/wg/MTE8PZAT/chat/unread-count`: im Harness noch nicht gestubbte Fixture-Requests.
- `404` auf `/_vercel/speed-insights/script.js`: lokale Build-/Fixture-Ressource fehlt.
- `net::ERR_ABORTED` bei mehreren `?_rsc=`-Requests nach Navigation: abgebrochene Next-RSC-Nebenrequests während der folgenden Navigation.

Diese Einträge sind für die weitere Abnahme im lokalen Harness zu isolieren; bis zur finalen Auswertung gelten sie nicht als Produktionsbeweis.

## Fachseiten: sichtbarer Zustand versus sichere Klick-Evidenz

Die folgenden 390×844-Light-Screenshots belegen, dass die jeweilige lokale Route bis zu einem sichtbaren Seitenzustand geladen wurde: Einkauf, Putzen, Kalender, Ausgaben, Abos, Mahnungen, Import, Pinnwand, Chat und Einstellungen. Die einzige vollständig belegte Interaktionskette ist die Shell-Navigation aus dem Abschnitt oben. Für die übrigen Screenshots ist aus dem abgebrochenen Harness kein vollständiger, persistierter Aktionslog verfügbar; deshalb werden die jeweiligen Speichern-/Abchecken-Klicks nicht als bestanden gewertet.

Ein zusätzlicher lokaler Playwright-Lauf auf Port 3102 startete vorhandene Fixture-Specs. Belegt wurden dabei folgende offene Zustände:

- `/wg/MTE8PZAT/abos`: Nach dem Anlegen von „Netflix“ scheiterte die vorhandene Spec an der Sichtbarkeitsprüfung `nächste Fälligkeit:` innerhalb der Netflix-Zeile. Der Testlauf ist damit nicht grün.
- `/wg/MTE8PZAT/chat`: Die vorhandene Spec konnte den Composer nicht eindeutig über `getByLabel('Chat-Nachricht')` wählen, weil der Name sowohl auf die Nachrichten-Region als auch auf das Textfeld passte. Der Chat-Sende-Klick ist dadurch nicht sicher belegt.
- `/wg/MTE8PZAT/import`: Der Lauf war beim Import-Test, als er sicher gestoppt wurde; Mapping/Vorschau/Commit sind in diesem Lauf nicht als abgeschlossen belegt.

Die Fixture-Umgebung meldete außerdem absichtlich fehlende Rate-Limit-, Push- und S3-Umgebungswerte. Das ist eine Einschränkung der lokalen Abnahmeumgebung, kein Produktionsbefund.

## Testmatrix

| Viewport | Theme | Reduced motion | Status |
|---|---|---|---|
| 390×844 | Light | reduce | Shell/Navigationsklicks belegt; Fachseiten sichtbar, Fachaktionen nicht vollständig belegt |
| 390×844 | Dark | reduce | nicht ausgeführt |
| 390×844 | Light/Dark | no-preference | nicht ausgeführt |
| 320×700 | Light/Dark | reduce | nicht ausgeführt |

## Offen oder nicht sicher klickbar

- Haushalt: Hinzufügen und Abchecken eines Einkaufsartikels, Vorrat speichern/Verbrauch, Putzaufgabe speichern, Kalendertermin speichern.
- Finanzen: Ausgaben-Editor mit Split-Vorschau und Speichern, Fixkosten vollständig speichern, Mahnungsaktion, Import bis Commit.
- Austausch: Pinnwand-Beitrag posten, Chat-Nachricht senden und Chat/Pinnwand-Rücknavigation.
- Einstellungen: alle Tabs, Theme-Wechsel und Offline-Hinweise als sichere Klickkette.
- Offline-/Fehler-/Retry-Zustände, Draft-Wiederaufnahme, Rücknavigation und Persistenz nach Retry.
- 320×700 sowie Dark-Theme- und No-preference-Läufe.

Für diese Punkte existiert in diesem gestoppten Lauf keine vollständige aktuelle Klick-/Zustands-/Netzwerk-Evidenz; sie dürfen nicht als bestanden ausgegeben werden.

## Einschränkung

Dies ist eine AI-Browser-Abnahme mit isoliertem Chromium und lokalen Fixture-Responses, keine Humanstudie und kein Nachweis für Produktions-, Auth-, Hosted-Preview-, Geräte- oder PWA-Verhalten. Es wurden keine Source-, Test-, Config-, Dependency-, Git- oder Deploy-Änderungen vorgenommen; ergänzt wurden ausschließlich dieser Report und die Browser-Screenshot-Assets.

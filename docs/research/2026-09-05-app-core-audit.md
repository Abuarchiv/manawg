# ManaWG App-Kern: Bestandsaufnahme vor dem Redesign

Stand: 5. September 2026. Checkout: `manawg-app-mobile-redesign`, Branch `codex/mobile-shadcn-redesign-20260905`, Commit `2e2b151c1cce482f2536d116ee22a73cb886fd2e`.

## Auftrag und Prüfgrenzen

Die Umsetzung wurde auf Nutzerwunsch angehalten. Zuerst soll der gesamte App-Kern verstanden werden; anschließend wird Seite für Seite gestaltet und implementiert. Die Architektur bleibt ein modularer Monolith. Der bereits bearbeitete öffentliche Einstieg wird nur als angrenzender Vertrag geprüft.

Alle 395 TS-/TSX-/CSS-Dateien unter `apps/web/src` (57.278 Zeilen) wurden im Team vollständig gelesen. Die Hauptprüfung hat kritische Befunde an den konkreten Aufrufstellen nachgeprüft. Zusätzlich wurden Service Worker, Konfiguration, Architekturprüfung und CI gelesen. Die datierte Dateiliste im Anhang grenzt diese Aussage ab: Nicht sämtliche Test-, Migrations-, Dokumentations- und Abhängigkeitsdateien wurden zeilenweise gelesen. Relevante Tests wurden nach Verhalten und Fehlerfällen ausgewertet.

Aktuell ausgeführt und bestanden: Typecheck ohne inkrementellen Cache, Biome (450 Dateien), Feature-Grenzen (7 Features), Analytics-Privacy-Check. Eine AST-basierte Importanalyse findet keine Zyklen unter den statisch auflösbaren Laufzeit-Imports. Dynamisch berechnete Imports sind damit nicht bewiesen. Builds, vollständige E2E-Suite, reale Datenbankfehler, Zahlungen, Push-Auslieferung und Lasttests wurden in diesem Audit nicht ausgeführt.

Browserprüfung erfolgt ausschließlich über die verbundene Chrome Extension auf der lokalen Test-WG. Die Fixture-Daten sind zwischen einigen Endpunkten unterschiedlich: Ein Dashboard-Betrag oder Einkaufszähler ist daher kein Beweis für einen tatsächlich gespeicherten Eintrag. Sichtprüfung und Nachweis realer Persistenz bleiben getrennt.

Abgeschlossener Seitenrundgang: Start, Einkauf, Putzen, Vorräte, Termine, Ausgaben, Fixkosten, Mahnungen, Import, Pinnwand, Chat, Einstellungen (alle vier Tabs), Aktivität, Suche und Offline. Die aus Einstellungen verlinkten Seiten `/agb` und `/impressum` wurden zusätzlich geöffnet und zeigen beide die 404-Seite. Die vorhandene Datenansicht enthält weiter Links darauf. Es wurden keine Formulare gespeichert, Nachrichten gesendet oder Exporte/Zahlungen ausgelöst. Dies war eine Bestandsaufnahme der verfügbaren Ansichten, kein vollständiger Interaktions-/Gerätetest aller Zustände.

Am Produktcode wurde nichts geändert. Der vorher angelegte Change `redesign-start-overview` ist ein vorläufiger Entwurf und bis zur anschließenden Seitenplanung nicht zur Ausführung bestimmt.

## Architektur, die tatsächlich vorhanden ist

Es gibt eine Next.js-App mit einer PostgreSQL-Datenbank. Die vier Navigationsziele sind Produktbereiche; sie sind nicht identisch mit den sieben Fachmodulen.

| Ebene | Aktueller Ort | Verantwortung |
| --- | --- | --- |
| Seiten und HTTP-Einstiege | `apps/web/src/app` | Navigation, Zusammensetzung, Clientzustand; HTTP-Validierung, Auth-Aufrufe und Aufruf fachlicher Operationen |
| Fachmodule | `src/features/{shopping,inventory,chores,events,expenses,pinnwand,chat}` | Fachfunktionen und funktionsbezogene UI; Umfang der Auslagerung ist je Modul unterschiedlich |
| Gemeinsamer Kern | `src/core` | Auth, Datenbankzugriff, Transaktionen, Fehler, Rate-Limits, Offline-Queue, Benachrichtigungen und modulübergreifende Leseansichten |
| UI-Basis | `src/components/ui`, `src/components/animate-ui` | Original-shadcn/Base-UI-Kompositionen und installierte Animate-UI-Bausteine |
| App-Rahmen und geteilte Darstellung | `src/components/app`, `src/components/wg`, `src/shared` | Navigation, WG-Kontext, Form-/Feedbackbausteine, Theme, PWA und Darstellungshilfen |

Die Ordnergrenzen sind noch keine vollständigen Fachgrenzen: Einige Operationen leben direkt in API-Routen; einige Seiten koordinieren mehrere Schreibaufrufe selbst. Ein erfolgreicher Check gegen direkte Feature-zu-Feature-Imports beweist weder atomare Schreibvorgänge noch eine klare Zuständigkeit für jeden Anwendungsfall.

`core/reads` und `core/activity-feed.ts` sind bewusst modulübergreifende Anwendungsfunktionen. Die Importanalyse zeigt fünf Core-zu-Feature-Imports, einschließlich eines Type-Imports. Diese sind nicht pauschal Fehler. Die Wartungsregel muss zwischen neutraler Infrastruktur und fachlicher Zusammensetzung unterscheiden, statt alles unter `core` für unabhängig zu erklären. Beispiele: [Dashboard-Aggregation](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/reads/dashboard-data.ts), [Systemmeldungen](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/activity-feed.ts).

## Seiten- und Vertragskarte

| Seite/Bereich | Primäre Aufgabe | Unbedingt erhalten |
| --- | --- | --- |
| Start | Relevante nächste Schritte und WG-Überblick | Persönlicher Saldo, echte Zuständigkeit, Deep Links, Ladefehler und Retry |
| Einkauf | Artikel sammeln und abhaken | Entwürfe, Offline-Queue, Abhaken/Rücknahme, Duplikatschutz |
| Vorräte | Bestände verwalten und nachfüllen | Versionsprüfung bei Verbrauch; Verlauf; automatische Einkaufsergänzung |
| Putzen | Aufgaben, Zuständigkeiten und Rotation | Abschluss und Rotation gemeinsam; Fairness; Abwesenheiten; Datumslogik |
| Termine | WG-Termine und Putzaufgaben überblicken | Wiederholungen, Zeitraumgrenzen, Kalender-Feed-Token, unterschiedliche Feed-/Agenda-Inhalte |
| Ausgaben | Ausgaben erfassen, aufteilen und ausgleichen | Centbeträge, Summe der Splits, Zahler-/Mitgliederprüfung, Entwürfe, echte Zahlungszustände |
| Fixkosten | Wiederkehrende Kosten pflegen und buchen | Pausieren, Rechte, Fälligkeit, genau eine Buchung pro Fälligkeit |
| Mahnungen | Tatsächliche Gläubiger-Schuldner-Beziehung klären | Unterschied zu vereinfachten Zahlungsplänen; Berechtigungen, Opt-out und Cooldown |
| Import | Fremddaten prüfen und übernehmen | Parsergrenzen, eindeutiges Mitgliedsmapping, Vorschau-Hash, Duplikatoption und Transaktion |
| Pinnwand | Beiträge und gemeinsame Anliegen bearbeiten | Entwürfe, Reaktionen/Kommentare, Rechte, Schutz lokaler Änderungen vor Hintergrund-Refresh |
| Chat | Gespräch, Antworten und Erwähnungen | Entwürfe, Pagination, Reaktionen, serverseitige Rechte, Lesestatus |
| Aktivität / Suche | Änderungen und Einträge finden | Bestehende Ziel-IDs, Hashes/Queryparameter, ehrliche Grenzen des Such-/Zeitfensters |
| Einstellungen | Profil, Benachrichtigungen, Zugang und Daten verwalten | Server als Identitätsquelle; Adminrechte; Code-Rotation; sichere Löschbestätigung; Queue-/Exportverträge |
| Offline / Fehlerseiten | Arbeit erhalten und Wiederaufnahme ermöglichen | Kein falscher Erfolg, kein stiller Entwurfsverlust, Retry und erreichbare Rückwege |

Die zentrale Navigationsdefinition liegt bereits in [navigation.ts](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/components/app/navigation.ts). Seiten dürfen keine weitere unabhängige Modulliste etablieren.

## Gute Grundlagen, die wir weiterverwenden

- Serververifizierte Supabase-Identität wird einer aktiven WG-Mitgliedschaft zugeordnet. Client-Mitgliedsheader sind im normalen Betrieb keine Autorität. UI-Rechte ersetzen keine Serverprüfung: [api-auth.ts](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/guards/api-auth.ts), [require-wg-member.ts](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/guards/require-wg-member.ts).
- Ausgaben und Splits sowie Putzabschluss und Rotation verwenden Transaktionen. Datenbank-Constraints ergänzen Anwendungsprüfungen.
- Entwürfe und Offline-Aktionen sind nach WG/Mitglied abgegrenzt. Nicht jede Funktion ist offline schreibbar; diese Unterschiede müssen sichtbar bleiben.
- Original-shadcn und Animate UI sind vorhanden. ThemeProvider setzt `MotionConfig reducedMotion="user"`; globale CSS-Regeln ergänzen reduzierte Bewegung. Es besteht kein belegter Anlass, überall zusätzliche Motion-Wrapper einzubauen.
- Relevante E2E-Spezifikationen enthalten bereits Race-, Rollback-, Offline-, Berechtigungs- und Fehlerfälle. Diese Verhaltensprüfungen sind wertvoller als reine Komponenten-Snapshots.
- Der Service Worker umgeht API/Auth und cached private WG-Dokumente nicht als normale Offline-Seiten: [sw.js](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/public/sw.js). Das darf beim App-Redesign nicht versehentlich aufgeweicht werden.

## Befunde mit Konsequenz für die Umsetzung

### 1. Finanzielle Wiederholungen benötigen einen eindeutigen fachlichen Besitzer

Eine manuelle Fixkostenbuchung erstellt in der Ausgaben-Seite erst eine normale Ausgabe und schiebt danach die Vorlage weiter. Die natürlichen Felder für den Duplikatschutz einer wiederkehrenden Buchung werden dabei nicht mitgeschrieben. Eine zweite parallele Buchung kann deshalb bereits existieren, bevor das Weiterschieben einen Konflikt meldet. Der Cron-Pfad nutzt die Zuordnung zur Vorlage/Fälligkeit dagegen.

Belege: [manuelle Buchung und Advance](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/app/wg/[code]/ausgaben/page.tsx:651), [Cron-Buchung](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/app/api/cron/recurring-advance/route.ts), [eindeutige DB-Schlüssel](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/db/schema.ts:164).

Auch der allgemeine Replay-Schutz hat eine nachweisbare Lücke: Bei fehlendem Cache-Ergebnis fällt der Aufrufer nach dem Polling wieder zur Mutation durch; Cache-Persistenz und Mutation sind getrennt. Ein verlorenes oder verspätetes Ergebnis ist kein Beweis, dass die erste Mutation fehlgeschlagen ist. Online-Aufrufe senden zudem nicht durchgängig einen stabilen Idempotency-Key.

Belege: [Expense-POST](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/app/api/wg/[code]/expenses/route.ts:204), [Replay-Claim](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/guards/idempotency.ts:130), [persistenter Cache](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/idempotency.ts), [API-Client](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/infra/api-client.ts).

Folge: Vor dem Finanzumbau diese beiden Fehlerabläufe mit einem gezielten Regressionstest reproduzieren und einmal innerhalb des Finanzmoduls lösen. Keine UI-Guard-Kopie pro Button. Das Audit ist Quellnachweis des Mechanismus, kein ausgeführter Cross-Instance-Fehlertest.

### 2. Vorratsverbrauch ist nur teilweise atomar

Der Mengenwechsel hat bereits eine Versionsprüfung. Mengenupdate, Verlaufszeile und automatische Einkaufsergänzung sind jedoch separate Datenbankoperationen. Ein Fehler nach dem Update kann einen geänderten Bestand ohne vollständigen Folgeeintrag hinterlassen.

Beleg: [consume/route.ts](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/app/api/wg/[code]/inventory/[id]/consume/route.ts:60).

Folge: Diesen zusammengehörigen Anwendungsfall vor dem Vorräte-Redesign als atomare Operation prüfen. Die vorhandene Versionsprüfung und Shopping-Unique-Constraint behalten.

### 3. Die Offline-Queue hat mehrere schreibende Oberflächen

Sync serialisiert seine eigenen Aufrufe. Einstellungen können parallel Einträge entfernen oder Anhänge ändern. Beim Sync-Abschluss werden die aus dem ursprünglichen Snapshot verbliebenen Einträge erneut geschrieben. Damit kann eine während des laufenden Requests entfernte, anschließend fehlgeschlagene Aktion wieder erscheinen; eine Bearbeitung kann durch alte Nutzdaten überschrieben werden.

Belege: [Sync-Zusammenführung](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/offline/offline-client.ts:489), [direkte Queue-Änderungen](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/components/wg/einstellungen/OfflineQueueSection.tsx:65).

Folge: Eine gemeinsame Zuständigkeit für Queue-Mutationen definieren und den konkreten Ablauf testen. Kein neues Storage-System auf Verdacht; zuerst die vorhandene Queue korrekt koordinieren. Eine bereits gesendete Aktion darf beim Verwerfen außerdem nicht als sicher rückgängig gemacht dargestellt werden.

### 4. Einige Lesewege wachsen mit der gesamten WG-Historie

Dashboard und Ausgaben lesen vollständige Historien und verdichten sie in JavaScript; Start und Finanzen aktualisieren regelmäßig. Putzplan liest den Abschlussverlauf zur Berechnung des letzten Abschlusses. Mit längerer Nutzung wächst dadurch die Arbeit pro Aufruf. Das ist ein belegtes Wachstumsverhalten, keine gemessene aktuelle Langsamkeit.

Belege: [Dashboard-Queries](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/reads/dashboard-data.ts:241), [Ausgaben-GET](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/app/api/wg/[code]/expenses/route.ts:75), [Putzplan-GET](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/app/api/wg/[code]/chores/route.ts:79).

Folge: Für Start nur die benötigte Leseansicht definieren. Bei Historien Datumsfenster/Pagination und SQL-Aggregation passend zur Seitenaufgabe einplanen; keine zusätzliche Polling-Schicht und keinen Cache ohne klare Aktualisierungsregeln. Suche und Aktivität sind bereits begrenzt, aber dadurch keine unbegrenzten Archive.

### 5. Produkt- und Darstellungszuständigkeiten sind teilweise doppelt

Fixkosten haben eine eigene Seite und eine separate Implementierung in Ausgaben, einschließlich unterschiedlicher Offline-Fähigkeiten. Dashboard-Aktivität und die vollständige Aktivität pflegen teilweise dieselben Texte getrennt. Alte Dashboard-Bausteine wie `BalanceBars`, `ModuleCard` und `Sparkline` haben in der geprüften Source-Suche keine aktiven Verbraucher. `globals.css` enthält zusätzlich zum shadcn-System alte Darstellungsfamilien.

Folge: Pro Anwendungsfall einen fachlichen Besitzer und pro verwendetem Darstellungsbaustein eine klare Quelle festlegen. Beim jeweiligen Seitenumbau nachgewiesen unbenutzte Teile entfernen. Keine pauschale Löschung aller Legacy-Wrapper: Manche werden noch gebraucht. Plain- und Animate-UI-Versionen sind ebenfalls nicht allein durch ihre Koexistenz ein Fehler.

### 6. Kommentare und Verträge sind teilweise hinter der Implementierung zurück

Mehrere Auth-Kommentare beschreiben noch HMAC-basierte Mitgliedsprüfung, obwohl die aktuelle Guard-Funktion Supabase-Identitäten verwendet. Der aktuelle Vertrag muss aus Implementierung und Tests hervorgehen. Andernfalls kann ein späterer Umbau alte Auth-Annahmen wieder einführen.

Belege: [alte Begrifflichkeit](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/guards/admin.ts), [aktuelle Identitätsprüfung](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/core/guards/api-auth.ts).

Folge: Bei Änderungen im betroffenen Modul dessen Vertrag und veraltete Kommentare direkt mitpflegen. Ein neues paralleles Architekturhandbuch mit widersprüchlichen Regeln würde das Problem vergrößern.

### 7. Die sichtbare Oberfläche enthält ebenfalls widersprüchliche Verträge

Der Chrome-Rundgang bestätigt auf Pinnwand und Chat zwei gleichzeitig sichtbare Wechselmöglichkeiten zwischen denselben Bereichen: die Navigation des App-Rahmens und die seiteninterne Navigation. Die gemeinsame Definition ist vorhanden, aber ihre Nutzung noch nicht einheitlich.

Im Profil steht außerdem „Diese Identität ist nur an dieses Gerät gebunden“, und der Einstellungsfuß nennt gerätegebundene Daten. Das beschreibt die heutige serverseitige Account-/WG-Zuordnung nicht korrekt. Lokale Entwürfe und Geräte-Push-Abonnements müssen sprachlich von Account und gespeicherten WG-Daten getrennt werden.

Belege: [Pinnwand-Kopf](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/features/pinnwand/components/PinnwandHeader.tsx:69), [App-Kopf](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/components/app/WgAppHeader.tsx:43), [Profiltext](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/components/wg/einstellungen/ProfileTab.tsx:86), [Einstellungsfuß](/Users/abu/Company/manawg-app-mobile-redesign/apps/web/src/app/wg/[code]/einstellungen/page.tsx:186).

Folge: Einheitliche Seitenrahmen und fachlich korrekte Begriffe gehören vor den visuellen Feinschliff. Im lokalen Rundgang zeigten Mahnungen, Chat-Refresh und Teile der Einstellungen Ladefehler; diese Ansichten gelten ausdrücklich nicht als funktional abgenommen.

Die Daten-Seite verlinkt außerdem `/agb` und `/impressum`, die im aktuellen Checkout nicht vorhanden sind und im verbundenen Chrome tatsächlich 404 anzeigen. Beim Seitenauftrag für Daten die richtigen Ziele festlegen und die bestehenden Links korrigieren; keine ungeprüften Inhalte oder Ersatzseiten erfinden.

## Vorgehen Seite für Seite

### Einmal vor der ersten Seite

Navigation, gemeinsame Kopfzeile, Typografie/Abstände, Formular- und Dialogverhalten sowie Bedeutung der Zustände `lädt`, `gespeichert`, `lokal vorgemerkt`, `fehlgeschlagen` und `Konflikt` festlegen. Vorhandene Base-Nova-/Neutral-/Inter-/Lucide-Basis verwenden. Diese Abstimmung ist klein und konkret; sie verlangt keinen vollständigen Neuaufbau der Architektur.

### Für jede Seite derselbe kurze Entwicklungszyklus

1. **Seitenauftrag:** Für wen, welches Hauptziel, welche wichtigste Aktion? Welche Inhalte gehören auf eine Fachseite statt in die Übersicht?
2. **Vertrag:** Datenquelle, Fachmodul, Schreiboperationen, Zuständigkeit/Rechte, Lade-/Leer-/Fehler-/Offline-/Konfliktzustände, Deep Links und angrenzende Funktionen festhalten.
3. **Entwurf:** Mobile Informationsreihenfolge und vorhandene shadcn-/Animate-UI-Bausteine anhand dieses Vertrags zusammensetzen. Mit dem Nutzer die konkrete Seite durchgehen.
4. **Kleiner vertikaler Umbau:** Eine Seite beziehungsweise einen zusammengehörigen Ablauf umsetzen. Fachlogik bleibt im zuständigen Modul; echte gemeinsame Regeln werden dort wiederverwendet. Keine spekulativen Repository-/Service-/Factory-Schichten.
5. **Beweis:** Die relevante Hauptaktion, Rücknahme/Fehler und betroffene Nachbarfunktion prüfen. Finanz-/Queue-/Transaktionsänderungen benötigen gezielte Wiederholungs-/Parallelitätsprüfungen. UI bei 320/390px, Tastatur, Dark Mode und reduzierter Bewegung prüfen.
6. **Abschluss:** Review, passende bestehende Gates, aktueller Graph und kurze Vertrags-/Entscheidungsnotiz. Erst danach zur nächsten Seite. Bestandene Fixture-Tests sind kein Beweis für Live-Auth, reale Persistenz oder Push-Zustellung.

### Empfohlene Reihenfolge

1. Gemeinsamer Rahmen und Start.
2. Einkauf → Vorräte → Putzen → Termine.
3. Ausgaben → Fixkosten → Mahnungen → Import, mit den oben genannten Finanzkorrekturen vor dem entsprechenden UI-Umbau.
4. Pinnwand → Chat.
5. Profil/Zugang → Benachrichtigungen → Daten/Offline-Queue.
6. Suche, Aktivität und sämtliche Fehler-/Offline-/Rückkehrpfade als abschließender Durchlauf.

Diese Reihenfolge ist eine Arbeitsreihenfolge, kein Auftrag für einen parallelen Komplettumbau. Die nächste konkrete Einheit ist der Seitenauftrag für Start auf Basis der nun geprüften Architektur.

## Grenzen der Aussage zur Skalierbarkeit

Der modulare Monolith passt weiterhin zur vorhandenen App. Aus dem Audit ergibt sich kein Bedarf für Microservices, ein Event-Bus-Framework, ein universelles State-Management oder eine neue Komponentenbibliothek. Skalierbarkeit wird hier zuerst durch begrenzte Abfragen, korrekte Indizes/Transaktionen, sichere Wiederholungen, nachvollziehbare Fehler und klare Modulverantwortung verbessert.

Leistungsziele und Auslagerungen benötigen Messwerte aus repräsentativen WGs. Ohne Lasttest lässt sich keine seriöse Nutzerzahl oder maximale Kapazität nennen. Benachrichtigungen sind aktuell überwiegend Best Effort; eine garantierte Zustellung wäre ein eigener fachlicher Auftrag und erst dann ein Anlass für eine dauerhafte Zustellwarteschlange.

## Quelleninventar

<details>
<summary>Vollständig gelesene 395 Dateien unter apps/web/src</summary>

```text
app/.well-known/apple-app-site-association/route.ts
app/.well-known/assetlinks.json/route.ts
app/EntryClient.tsx
app/api/auth/recovery/route.ts
app/api/calendar/[id]/[token]/route.ts
app/api/cron/chore-reminders/route.ts
app/api/cron/event-reminders/route.ts
app/api/cron/recurring-advance/route.ts
app/api/health/route.ts
app/api/upload/sign/route.ts
app/api/wg/[code]/absences/[id]/route.ts
app/api/wg/[code]/absences/route.ts
app/api/wg/[code]/activity/route.ts
app/api/wg/[code]/announcements/[id]/comments/[commentId]/route.ts
app/api/wg/[code]/announcements/[id]/comments/route.ts
app/api/wg/[code]/announcements/[id]/reactions/route.ts
app/api/wg/[code]/announcements/[id]/route.ts
app/api/wg/[code]/announcements/route.ts
app/api/wg/[code]/calendar-subscription/route.ts
app/api/wg/[code]/chat/messages/[id]/reactions/route.ts
app/api/wg/[code]/chat/messages/[id]/route.ts
app/api/wg/[code]/chat/messages/route.ts
app/api/wg/[code]/chat/read/route.ts
app/api/wg/[code]/chat/unread-count/route.ts
app/api/wg/[code]/chores/[id]/complete/route.ts
app/api/wg/[code]/chores/[id]/route.ts
app/api/wg/[code]/chores/route.ts
app/api/wg/[code]/dashboard/route.ts
app/api/wg/[code]/events/[id]/route.ts
app/api/wg/[code]/events/route.ts
app/api/wg/[code]/expenses/[id]/route.ts
app/api/wg/[code]/expenses/[id]/splits/[splitId]/settle/route.ts
app/api/wg/[code]/expenses/route.ts
app/api/wg/[code]/expenses/settle-batch/route.ts
app/api/wg/[code]/export/route.ts
app/api/wg/[code]/imports/commit/route.ts
app/api/wg/[code]/imports/preview/route.ts
app/api/wg/[code]/inventory/[id]/consume/route.ts
app/api/wg/[code]/inventory/[id]/route.ts
app/api/wg/[code]/inventory/route.ts
app/api/wg/[code]/members/[id]/claim/route.ts
app/api/wg/[code]/members/[id]/route.ts
app/api/wg/[code]/members/route.ts
app/api/wg/[code]/notifications/route.ts
app/api/wg/[code]/paypal/capture/route.ts
app/api/wg/[code]/paypal/order/route.ts
app/api/wg/[code]/recurring-expenses/[id]/route.ts
app/api/wg/[code]/recurring-expenses/route.ts
app/api/wg/[code]/reminders/balances/route.ts
app/api/wg/[code]/reminders/route.ts
app/api/wg/[code]/route.ts
app/api/wg/[code]/search/route.ts
app/api/wg/[code]/shopping/[id]/route.ts
app/api/wg/[code]/shopping/route.ts
app/api/wg/mine/route.ts
app/api/wg/route.ts
app/auth/callback/route.ts
app/auth/reset/page.tsx
app/datenschutz/page.tsx
app/entdecken/[module]/page.tsx
app/error.tsx
app/global-error.tsx
app/layout.tsx
app/neu/NeuClient.tsx
app/neu/layout.tsx
app/neu/page.tsx
app/not-found.tsx
app/offline/OfflineClient.tsx
app/offline/page.tsx
app/page.tsx
app/wg/[code]/abos/page.tsx
app/wg/[code]/aktivitaet/error.tsx
app/wg/[code]/aktivitaet/page.tsx
app/wg/[code]/ausgaben/error.tsx
app/wg/[code]/ausgaben/page.tsx
app/wg/[code]/chat/error.tsx
app/wg/[code]/chat/loading.tsx
app/wg/[code]/chat/page.tsx
app/wg/[code]/einkauf/error.tsx
app/wg/[code]/einkauf/page.tsx
app/wg/[code]/einstellungen/error.tsx
app/wg/[code]/einstellungen/page.tsx
app/wg/[code]/error.tsx
app/wg/[code]/import/error.tsx
app/wg/[code]/import/page.tsx
app/wg/[code]/kalender/error.tsx
app/wg/[code]/kalender/page.tsx
app/wg/[code]/layout.tsx
app/wg/[code]/loading.tsx
app/wg/[code]/mahnungen/error.tsx
app/wg/[code]/mahnungen/page.tsx
app/wg/[code]/not-found.tsx
app/wg/[code]/page.tsx
app/wg/[code]/pinnwand/error.tsx
app/wg/[code]/pinnwand/page.tsx
app/wg/[code]/putzen/error.tsx
app/wg/[code]/putzen/page.tsx
app/wg/[code]/suche/page.tsx
app/wg/[code]/vorraete/error.tsx
app/wg/[code]/vorraete/page.tsx
components/animate-ui/components/base/checkbox.tsx
components/animate-ui/components/base/switch.tsx
components/animate-ui/primitives/base/checkbox.tsx
components/animate-ui/primitives/base/collapsible.tsx
components/animate-ui/primitives/base/switch.tsx
components/app/WgAppHeader.tsx
components/app/navigation.ts
components/auth/CredentialsAuth.tsx
components/auth/LegacyAccountRecovery.tsx
components/auth/PasswordResetForm.tsx
components/auth/SocialLoginButtons.tsx
components/entry/EntryFrame.tsx
components/entry/PublicApp.tsx
components/entry/PublicModulePreview.tsx
components/entry/WgWelcome.tsx
components/neu/BackButton.tsx
components/neu/ErrorBox.tsx
components/neu/Field.tsx
components/neu/InviteStep.tsx
components/ui/ConfirmDialog.tsx
components/ui/DeleteConfirmButton.tsx
components/ui/EmptyState.tsx
components/ui/Toast.tsx
components/ui/alert-dialog.tsx
components/ui/alert.tsx
components/ui/attachment.tsx
components/ui/avatar.tsx
components/ui/badge.tsx
components/ui/bubble.tsx
components/ui/button.tsx
components/ui/card.tsx
components/ui/checkbox.tsx
components/ui/collapsible.tsx
components/ui/command.tsx
components/ui/dialog.tsx
components/ui/drawer.tsx
components/ui/dropdown-menu.tsx
components/ui/empty.tsx
components/ui/field.tsx
components/ui/input-group.tsx
components/ui/input.tsx
components/ui/item.tsx
components/ui/label.tsx
components/ui/liquid-glass-surface.tsx
components/ui/marker.tsx
components/ui/message-scroller.tsx
components/ui/message.tsx
components/ui/native-select.tsx
components/ui/progress.tsx
components/ui/radio-group.tsx
components/ui/select.tsx
components/ui/separator.tsx
components/ui/skeleton.tsx
components/ui/spinner.tsx
components/ui/styles.ts
components/ui/switch.tsx
components/ui/tabs.tsx
components/ui/textarea.tsx
components/ui/toggle-group.tsx
components/ui/toggle.tsx
components/wg/AboCreateModal.tsx
components/wg/AboEditModal.tsx
components/wg/AboForm.tsx
components/wg/AboModalShell.tsx
components/wg/AboPausedBadge.tsx
components/wg/AboRow.tsx
components/wg/AbosList.tsx
components/wg/ActionNoticeBanner.tsx
components/wg/BackLink.tsx
components/wg/ChatTopBarLink.tsx
components/wg/DebtRow.tsx
components/wg/DebtSummary.tsx
components/wg/ImageUploader.tsx
components/wg/LoadErrorBanner.tsx
components/wg/MemberAvatar.tsx
components/wg/MemberDeactivateDialog.tsx
components/wg/NavItem.tsx
components/wg/OfflineBanner.tsx
components/wg/OfflineQueueNotice.tsx
components/wg/PageHeaderActions.tsx
components/wg/PayPalPaymentButton.tsx
components/wg/ProviderIcon.tsx
components/wg/RemindButton.tsx
components/wg/ReminderHistory.tsx
components/wg/ShareWgCard.tsx
components/wg/SubNav.tsx
components/wg/WgContextProvider.tsx
components/wg/WgRouteErrorBoundary.tsx
components/wg/abos-types.ts
components/wg/dashboard/ActivityFeed.tsx
components/wg/dashboard/BalanceBars.tsx
components/wg/dashboard/CopyCodeButton.tsx
components/wg/dashboard/DashboardSkeletons.tsx
components/wg/dashboard/ModuleCard.tsx
components/wg/dashboard/Panel.tsx
components/wg/dashboard/Sparkline.tsx
components/wg/dashboard/Stat.tsx
components/wg/dashboard/TodayIcon.tsx
components/wg/einstellungen/AccessTab.tsx
components/wg/einstellungen/DataTab.tsx
components/wg/einstellungen/LinkRow.tsx
components/wg/einstellungen/NotificationSection.tsx
components/wg/einstellungen/OfflineQueueSection.tsx
components/wg/einstellungen/ProfileTab.tsx
components/wg/einstellungen/Section.tsx
components/wg/einstellungen/ThemeOption.tsx
core/activity-feed.ts
core/audit.ts
core/auth/client.ts
core/auth/env.ts
core/auth/middleware.ts
core/auth/next-path.ts
core/auth/server.ts
core/db/connection.ts
core/db/index.ts
core/db/schema.ts
core/db/transaction-abort.ts
core/db/transaction.ts
core/errors.ts
core/errors/generic-error-codes.ts
core/guards/admin.ts
core/guards/api-auth.ts
core/guards/idempotency.ts
core/guards/load-errors.ts
core/guards/member-token.ts
core/guards/require-wg-admin.ts
core/guards/require-wg-member.ts
core/guards/resolve.ts
core/guards/route-preamble.ts
core/guards/settings-errors.ts
core/guards/settings-tabs.ts
core/guards/with-wg-route.ts
core/hooks/useConfirmDelete.ts
core/hooks/useDismissableMenu.ts
core/hooks/useModalDialog.ts
core/hooks/usePendingSet.ts
core/idempotency.ts
core/infra/api-client.ts
core/infra/api-types.ts
core/infra/cron-auth.ts
core/infra/e2e-db-down.ts
core/infra/env.ts
core/infra/join-flow.ts
core/infra/observability.ts
core/infra/paypal.ts
core/infra/s3.ts
core/infra/security.ts
core/notifications/notification-dispatch.ts
core/notifications/notification-preferences.ts
core/notifications/notifications.ts
core/notifications/push-priming.ts
core/notifications/push-subscribe.ts
core/notifications/web-push-errors.ts
core/offline/drafts.ts
core/offline/offline-client.ts
core/offline/offline-conflicts.ts
core/offline/offline-copy.ts
core/offline/offline-images.ts
core/offline/offline-queue.ts
core/offline/useOfflineQueueSync.ts
core/rate-limit.ts
core/reads/activity.ts
core/reads/dashboard-data.ts
core/reads/dashboard-insights.ts
core/reads/dashboard-links.ts
core/reads/export.ts
core/reads/onboarding.ts
core/reads/search.ts
core/utils/amount.ts
core/utils/berlin-day.ts
core/utils/clipboard.ts
core/utils/money.ts
core/utils/time.ts
core/utils/use-visibility-paused-interval.ts
core/utils/utils.ts
core/validators/currency.ts
core/validators/image-url.ts
core/validators/push-endpoint.ts
features/chat/chat-channel.ts
features/chat/chat-pure.ts
features/chat/components/ChatComposer.tsx
features/chat/components/ChatView.tsx
features/chat/components/MentionAutocomplete.tsx
features/chat/components/MessageBubble.tsx
features/chat/components/MessageList.tsx
features/chat/components/ReactionPicker.tsx
features/chat/components/SystemMessage.tsx
features/chat/components/TypingIndicator.tsx
features/chores/absence.ts
features/chores/chore-errors.ts
features/chores/chore-fairness.ts
features/chores/chore-recurrence.ts
features/chores/chore-status.ts
features/chores/components/AbsencePanel.tsx
features/chores/components/ChoreForm.tsx
features/chores/components/ChoreRow.tsx
features/chores/components/FairnessPanel.tsx
features/chores/components/HealthStrip.tsx
features/chores/components/ListSkeleton.tsx
features/chores/components/PutzenHeader.tsx
features/chores/components/chore-types.ts
features/chores/components/constants.ts
features/events/calendar-subscription.ts
features/events/components/CalendarMonth.tsx
features/events/components/CalendarUpcomingList.tsx
features/events/components/EventCreateModal.tsx
features/events/components/EventEditModal.tsx
features/events/components/EventFormFields.tsx
features/events/event-reminder-window.ts
features/events/events.ts
features/events/ics.ts
features/expenses/components/ausgaben/AusgabenHeader.tsx
features/expenses/components/ausgaben/ExpenseFormSection.tsx
features/expenses/components/ausgaben/ExpenseRow.tsx
features/expenses/components/ausgaben/ExpensesSkeleton.tsx
features/expenses/components/ausgaben/ManualSplitSummary.tsx
features/expenses/components/ausgaben/RecurringExpensesSection.tsx
features/expenses/components/ausgaben/SplitReview.tsx
features/expenses/components/ausgaben/TextField.tsx
features/expenses/components/ausgaben/constants.ts
features/expenses/components/ausgaben/expense-types.ts
features/expenses/components/ausgaben/useExpenseForm.ts
features/expenses/components/import/ImportMemberMapping.tsx
features/expenses/components/import/ImportPreviewTable.tsx
features/expenses/components/import/ImportProgress.tsx
features/expenses/components/import/ImportSourcePicker.tsx
features/expenses/components/import/ImportWizard.tsx
features/expenses/debt-reduction.ts
features/expenses/debts.ts
features/expenses/expense-constants.ts
features/expenses/expense-errors.ts
features/expenses/expense-payments.ts
features/expenses/expense-prefill.ts
features/expenses/expense-split-input.ts
features/expenses/expenses.ts
features/expenses/import-body.ts
features/expenses/import-commit.ts
features/expenses/import-hash.ts
features/expenses/import-parsers.ts
features/expenses/ocr.ts
features/expenses/open-expenses.ts
features/expenses/recurring-expenses.ts
features/expenses/reminders.ts
features/expenses/split-math.ts
features/inventory/components/InventoryAddModal.tsx
features/inventory/components/InventoryItemRow.tsx
features/inventory/components/InventoryList.tsx
features/inventory/components/QuickRestockSheet.tsx
features/inventory/inventory-decrements.ts
features/inventory/inventory.ts
features/pinnwand/announcement-errors.ts
features/pinnwand/announcement-lookup.ts
features/pinnwand/announcement-workflow.ts
features/pinnwand/components/AnnouncementCard.tsx
features/pinnwand/components/AnnouncementSkeleton.tsx
features/pinnwand/components/EmptyState.tsx
features/pinnwand/components/MyOpenAnnouncements.tsx
features/pinnwand/components/PinnwandComposer.tsx
features/pinnwand/components/PinnwandFilterBar.tsx
features/pinnwand/components/PinnwandHeader.tsx
features/pinnwand/components/announcement-types.ts
features/pinnwand/components/constants.ts
features/pinnwand/pinnwand-prefill.ts
features/shopping/components/ListSkeleton.tsx
features/shopping/components/ShoppingItemRow.tsx
features/shopping/components/constants.ts
features/shopping/components/shopping-types.ts
features/shopping/shopping-errors.ts
hooks/use-controlled-state.tsx
instrumentation-client.ts
instrumentation.ts
lib/get-strict-context.tsx
middleware.ts
shared/components/install-button.tsx
shared/components/install-prompt.tsx
shared/components/push-priming-prompt.tsx
shared/components/pwa-register.tsx
shared/components/theme/ThemeProvider.tsx
shared/components/theme/ThemeToggle.tsx
shared/components/ui/LogoMark.tsx
shared/globals.css
shared/lib/analytics.ts
shared/lib/app-url.ts
shared/lib/brand.ts
shared/lib/cn.ts
shared/lib/haptics.ts
shared/lib/hooks/useFocusTrap.ts
shared/lib/identity.ts
shared/lib/install-dismissal.ts
shared/lib/member-header.ts
shared/lib/pwa-install.ts
shared/lib/security-headers.ts
shared/lib/share-code.ts
shared/lib/theme.ts
test-support/source-tree.ts
```

</details>

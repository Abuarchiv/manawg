# UX-Konkurrenzanalyse WG-/Haushalts-Apps

Stand: 2026-09-22. Ziel: Muster finden, die ManaWG übernehmen und übertreffen kann.
Grundlage: Herstellerseiten, App-Store-Einträge, Plattform-Richtlinien, Tests und UX-Fallstudien (Quellen je Abschnitt).
Einschränkung: Keine App wurde installiert. Genaue Tab-Reihenfolgen sind für mehrere Apps nicht öffentlich dokumentiert und darum hier nicht behauptet.

## 1. Navigation und Informationsarchitektur

| App | Hauptbereiche | Beobachtung |
|---|---|---|
| Flatastic | Einkaufsliste, Putzplan, Ausgaben, Pinnwand (4) | Offizielle Seite nennt genau vier Funktionen und „No unnecessary gimmicks“. [flatastic-app.com](https://www.flatastic-app.com/en/) |
| Flatastic (Kritik) | + Verträge/Abos | Test: „kann Vieles aber nichts wirklich gut“, man verliert schnell den Überblick. [Die Smart WG](https://www.diesmartwg.com/flatastic-und-tricount-unsere-smarten-organisatoren/) |
| Splitwise | Gruppen → Ausgabenliste zuerst, Salden hinter Knopf | Tests: Salden versteckt, Settle-Up schwer zu finden. [UX Collective](https://uxdesign.cc/splitwise-a-ux-case-study-dc2581971226), [Snowdog](https://www.snow.dog/blog/case-study-redesigning-the-splitwise-app-design-team-day) |

Plattform-Regeln (Apple HIG Tab Bars, Inhalt aus Modellwissen, nicht wörtlich verifiziert – [Quelle](https://developer.apple.com/design/human-interface-guidelines/tab-bars)):
- Tab-Leiste = Navigation zwischen Hauptbereichen, **keine Aktionen**; Aktionen gehören in eine Toolbar.
- Tab-Leiste bleibt beim Drill-down sichtbar; nur Modals verdecken sie.
- **Segmented Control** = Umschalten verwandter Ansichten innerhalb eines Bereichs. Nicht für App-weite Navigation.
- Badges sparsam, nur für wirklich Neues.

**Für ManaWG:** 4 Tabs sind richtig (entspricht Flatastic, Brandbook). Die Unterbereiche gehören in ein Segmented Control oben, das immer alle Geschwister zeigt und das aktive markiert. Heute blendet `SubNav.tsx` die aktuelle Seite aus – das widerspricht dem Muster. Mahnungen und Import sind Aktionen, keine Ziele.

## 2. Einkaufsliste

- **Bring!**: Kacheln mit Icons statt Text, ein Tipp fügt hinzu; Kategorien aufklappbar; Suche/Eingabe unten; Listenansicht als Alternative. [MakeUseOf](https://www.makeuseof.com/organize-family-shopping-with-bring-grocery-app/), [Bring! Blog](https://www.getbring.com/blog-posts/the-best-shopping-list-app)
- Bring!-Kritik: Erstnutzer wissen nicht, wo die eigentliche Liste ist. [Glovory](https://glovorydesign.medium.com/redesign-bring-apps-shopping-list-e05c29bfcd39)
- **Flatastic**: „Your most bought items show up first“, mehrere Listen, Fotos für genaues Produkt. [flatastic-app.com](https://www.flatastic-app.com/en/)
- **OurHome**: Artikel im Laden per Wischen abhaken. [Tidied](https://www.tidied.app/blog/ourhome-app-review)
- Lücke bei Flatastic: keine Verknüpfung Einkauf → Ausgabe. [NBB Blog](https://blog.nbb.com/test-flatastic-app-wg-organisation-leicht-gemacht/)

**Für ManaWG:**
1. Eine einzeilige Eingabe (Menge optional im Text, z. B. „2 Hafermilch“), fixiert über der Tab-Leiste – nicht ein 200px-Formular oben.
2. Zeilen: Checkbox links, Name + Menge in einer Zeile. Wischen = gekauft.
3. Vorschlags-Chips „Oft gekauft“ + „Vorrat niedrig“ direkt unter der Eingabe (Bring!-Tempo ohne Kachel-Verwirrung).
4. Nach dem Einkauf: „Beleg für 4 Artikel als Ausgabe erfassen?“ – schließt die Flatastic-Lücke.

## 3. Ausgaben und Saldo

- Splitwise-Tests: Ausgabenliste steht vorn, Salden versteckt; zwei Orte zum Ausgleichen verwirren. Vorschlag: **Saldo-Tab zuerst**, Ein-Tipp-Ausgleich. [UX Collective](https://uxdesign.cc/splitwise-a-ux-case-study-dc2581971226), [Aubergine](https://www.aubergine.co/insights/the-art-of-spending-helping-splitwise-split-right)
- Splitwise Settle-Up: zwei Avatare mit Pfeil dazwischen zeigen die Geldrichtung. [IXD@Pratt 2026](https://ixd.prattsi.org/2026/02/design-critique-splitwise-mobile-app/)
- Tricount: eine Salden-Ansicht mit vorgeschlagenen Rückzahlungen, „Als bezahlt markieren“, möglichst wenige Überweisungen. [TechCrunch](https://techcrunch.com/2016/04/21/tricount/amp/), [Spark](https://joinspark.app/blogs/en/tricount-best-practices-for-roommates-fair-splits-and-tracking)
- Vereinfachung verschiebt Schulden zwischen Personen; Settle Up macht sie abschaltbar. Empfehlung: vereinfachte Zahlung **und** zugrunde liegende Paare zeigen. [Settle Up Tips](https://settleup.io/tips), [Splitwise](https://www.splitwise.com/l/sdv/c1mHsiFUb9x)
- Redesign-Konzept: Wischen = ausgleichen, andere Richtung = erinnern. [UX Planet](https://uxplanet.org/splitwiser-the-all-new-splitwise-mobile-app-redesign-ui-ux-case-study-4d3c0313ae6f)

**Für ManaWG:**
1. Oben eine Saldo-Karte: „Mina schuldet dir 4,43 €“ mit Avatar→Pfeil→Avatar und zwei Knöpfen: **Ausgleichen** / **Erinnern**. Damit entfällt die eigene Seite „Mahnungen“.
2. Überall dieselbe verrechnete Zahl. Heute zeigt Mahnungen unverrechnete Paare (`mahnungen/page.tsx:144`, `computeBalances`) – falsch und verwirrend.
3. „Details“ klappt die Paare auf (Vertrauen, wie empfohlen).
4. Verlauf nach Woche gruppiert.

## 4. Putzplan

- Flatastic: Punkte nach Aufwand, Erinnerungen, „Remind others“; Aufgaben auch „nach Bedarf“. [flatastic-app.com](https://www.flatastic-app.com/en/), [Netzsieger](https://www.netzsieger.de/p/flatastic)
- Sweepy: Sauberkeitsstatus pro Raum, dringende Aufgaben zuerst, Tagesliste pro Person, Aufwandspunkte 1–3; Gamification (Rangliste, Münzen) abschaltbar. [sweepy.com](https://sweepy.com/), [App Store](https://apps.apple.com/us/app/sweepy-home-cleaning-schedule/id1498897320), [Plastnofy](https://plastnofy.com/articles/tody-vs-sweepy)
- Sweepy/Tody-Schwäche: aufwendige Einrichtung, viele brechen beim ersten Bildschirm ab. [Plastnofy](https://plastnofy.com/articles/tody-vs-sweepy)
- Punkte können zum Wettbewerb werden (Nutzerzitat Flatastic). [flatastic-app.com](https://www.flatastic-app.com/en/)

**Für ManaWG:**
1. Gruppen „Du bist dran“ → „Überfällig“ → „Diese Woche“ → „Später“. Nur eigene fällige Aufgaben bekommen den gefüllten Knopf; andere bekommen „Erinnern“.
2. Fairness statt Rangliste: ein kleiner Balken „Anteil diesen Monat“ pro Person (passt zum Brandbook „keine Schuldzuweisung“).
3. Vorlagen beim ersten Start („Bad, Küche, Müll, Staubsaugen“ mit einem Tipp) statt leerer Einrichtung.

## 5. Startseite

- Keine der Apps dokumentiert einen echten Start-Überblick; Flatastic nutzt die Pinnwand als „High-level overview“. [flatastic-app.com](https://www.flatastic-app.com/en/)
- Sweepy erstellt automatisch eine Tagesliste pro Person. [sweepy.com](https://sweepy.com/)

**Für ManaWG (Chance zur Abhebung):** Start = „Heute für dich“: eine abhakbare Liste aus eigenen Aufgaben, fälligen Zahlungen, offenen Pinnwand-Fragen – direkt erledigen, ohne Seitenwechsel. Darunter 2×2-Kacheln (Saldo, Einkauf, Putzen, Termine) als Sprungpunkte. Keine doppelten Einträge.

## 6. Wo ManaWG sich abheben kann

| Schwäche der Konkurrenz | ManaWG-Antwort |
|---|---|
| Flatastic: zu viel, unübersichtlich | 4 Tabs + Segmented Control, Nebenfunktionen als Aktionen |
| Splitwise: Saldo versteckt, Ausgleichen schwer | Saldo-Karte zuerst, Ausgleichen/Erinnern mit einem Tipp |
| Flatastic: Einkauf ≠ Ausgaben | Einkauf abschließen → Ausgabe vorbefüllt |
| Sweepy/Tody: mühsame Einrichtung | Vorlagen beim Start |
| Punkte-Wettbewerb | Fairness-Anzeige ohne Rangliste |
| OurHome: Kalender nicht synchronisierbar | ManaWG hat Kalender-Abo – sichtbar bewerben |

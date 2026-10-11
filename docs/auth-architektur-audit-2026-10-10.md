# Auth-Architektur: Reste der lokalen Anmeldung (Audit 2026-10-10)

Pfade relativ zu `apps/web/src`, sofern nicht anders angegeben. Grundlage: 5 Lesedurchgänge über alle Auth-Schichten, danach Gegenprüfung jedes hohen und mittleren Fundes durch einen zweiten Leser mit dem Auftrag, ihn zu widerlegen. Nichts wurde geändert, nichts ausgeführt.

## 1. Ist-Zustand in einem Satz

Der Server ist sauber: Identität ist ausschließlich die Supabase-Cookie-Session, aufgelöst zu `wg_members.auth_user_id`. Die Vermischung lebt im Client und im Test-Modus.

```
Browser ──Cookie sb-*-auth-token──▶ middleware.ts (Refresh, /wg/* Redirect)
                                      │
                                      ▼
                             app/wg/[code]/layout.tsx  getWgViewer()  ──▶ wg_members WHERE auth_user_id = user.id
                                      │ initialIdentity {memberId, name, authUserId}
                                      ▼
                             WgContextProvider ──▶ use-session-member.ts
                                      │                 │ GET /api/wg/[code]  (zweiter Lookup)
                                      │                 ▼
                                      │        localStorage manawg_identity:<wgId>   ◀── Cache, Offline-Join, Legacy-Token, Fixture-Identität
                                      ▼
                             apiFetch + Header x-manawg-expected-member-id
                                      │
                                      ▼
                             core/guards/api-auth.ts requireMember()  (Header nur Abgleich → 409)
```

Vier Dinge teilen sich heute denselben localStorage-Key `manawg_identity:<wgId>`:

| Rolle | Wer liest | Wer schreibt |
|---|---|---|
| Cache der server-verifizierten Identität | `use-session-member.ts` Fallback bei 0/429/5xx | nur `use-session-member.ts:94` nach erfolgreichem GET |
| Besitzer-Join für die Offline-Queue (`authUserId`) | `offline-store.ts:233-243`, `OfflineClient.tsx` | dito |
| Legacy-Beweis `memberToken` (HMAC) | `getLegacyIdentityCandidates`, Claim-Route | niemand mehr |
| Identität im E2E-Fixture-Modus (`sessionless`) | `use-session-member.ts:56-65`, `fixtures/api.ts:150` | `e2e/support/helpers.ts setupMember` |

Was NICHT gefunden wurde: keine Route, die den Expected-Member-Header als Identität nimmt; kein Fail-open bei Auth-Ausfall; keine Spalte oder Tabelle aus der lokalen Phase; doppelte Mitgliedschaft ist per Unique-Index + Lock ausgeschlossen; RLS aktiv ohne Policies, Guards sind die einzige Autorisierung (konsistent dokumentiert).

## 2. Zielbild

1. **Eine Wahrheitsquelle:** Supabase-Session + `wg_members.auth_user_id`. Das Layout liefert die Identität, der Client schreibt sie einmal in den Cache und holt sie nicht erneut.
2. **localStorage ist nur Cache:** Key umbenennen zu `manawg_member:<wgId>`, `authUserId` Pflicht, kein `name` (Roster ist Wahrheit), kein `memberToken`.
3. **Session ≠ Mitgliedschaft:** eigener Zustand `sessionEnded`; „Kein Zugriff" nur bei `not_a_member` / `member_deactivated`.
4. **Offline-Queue kennt ihren Besitzer** über den Cache-Eintrag, aber 401 ist nie terminal, und Logout warnt vor ungesendeten Aktionen.
5. **Legacy-Claim mit Enddatum:** Prod zählen, Frist setzen, dann Claim-Route, Recovery-UI, HMAC-Beweis und `memberToken` löschen.
6. **Fixture-Modus ohne Produktionsverzweigung:** E2E mit echter Session (Postgres-Service + Supabase CLI oder GoTrue-Stub + `storageState`), danach `sessionless`, `isE2EDbDownMode` und `src/fixtures/` entfernen.

## 3. Bestätigte Funde

Schweregrad nach Gegenprüfung. „hoch" = Nutzer sieht falsches Verhalten oder verliert Daten; „mittel" = falsche Meldung, Inkonsistenz, Komplexität; „niedrig" = tot, Hygiene.

### Hoch

| Nr | Datei:Zeile | Problem | Fix |
|---|---|---|---|
| H1 | `app/offline/OfflineClient.tsx:37-45,72-77` | `getSession()` liefert bei abgelaufenem Access-Token ohne Netz `{session:null, error}` (auth-js 2.112.4 `__loadSession`). Code macht daraus `null` → Queue auf `[]` gefiltert, Status `unauthenticated`, „Melde dich an" auf der Offline-Seite, obwohl angemeldet. Trifft den Normalfall (>1 h offline). | `getLocalAuthUserId`: bei `AuthRetryableFetchError` die `authUserId` aus den gespeicherten Identitäten nehmen (neue Hilfsfunktion `soleStoredAuthUserId` in `identity.ts`); catch-Zweig Z. 108 auf `server-unreachable` statt `unauthenticated`. |
| H2 | `core/auth/client.ts:222-255` + Aufrufer `AccountSignOutSection`, `NeuClient.switchAccount`, `SignOutActions` | Logout/Kontowechsel löscht `manawg:offline-actions` und IndexedDB-Fotos ohne Prüfung oder Warnung. Bewusst als Datenschutz gebaut, aber ohne Schutz für ungesendete Aktionen. | In `signOutSocialAccount` vor `auth.signOut` Best-Effort `syncOfflineActions` mit Timeout; bleibt `countOfflineActions() > 0`, Bestätigung „N ungesendete Aktionen gehen verloren". |

### Mittel

| Nr | Datei:Zeile | Problem | Fix |
|---|---|---|---|
| M1 | `components/wg/use-session-member.ts:110-126` | Transienter Fehler (0/429/5xx) beim zweiten Lookup: Fallback liest nur den localStorage-Cache, ignoriert die server-verifizierte `initialIdentity`. Cache ist leer beim ersten Besuch nach Create/Join, nach Logout+Login, nach iOS-Storage-Purge → „WG nicht geladen" obwohl SSR korrekt war. 429 kommt vom IP-Limiter (geteiltes WLAN realistisch). | Im ersten Effekt (Z. 54-67): `if (initialIdentity?.authUserId && stored?.authUserId !== initialIdentity.authUserId) setIdentity(wg.id, initialIdentity)`. Ein Schreibpunkt am Ursprung. |
| M2 | `use-session-member.ts:121-126,147-157,185-199`, `WgContextProvider.tsx:258-270` | `identity === null` bedeutet gleichzeitig „Session weg" und „nicht Mitglied". Bei SIGNED_OUT, leerem `getSession` oder 401 `auth_required` erscheint „Kein Zugriff … ausgezogen oder entfernt". `SessionExpiredBanner` ist Kind des Providers und wird dann nicht gerendert. Beim eigenen Logout flackert die Karte bis `router.push`. | Flag `sessionEnded` in `clearSessionIdentity` und im `auth_required`-Zweig setzen; Provider rendert vor `!identity` eine Karte „Sitzung beendet" mit Link `/neu?next=…`. |
| M3 | `core/offline/offline-sync.ts:163,273-288`, `offline-replay-rules.ts:129-135` | 401 `auth_required` zählt als terminal → Präfix „Server prüfen:", `needsManualOfflineResolution` sperrt den Retry, Button verschwindet. Text sagt „melde dich neu an und versuche es erneut", nach Login geht nur Verwerfen. Schleife bricht bei 401 nicht ab (jede Aktion bekommt eigenen 401). Auslöser selten (Refresh-Token weg), Folge hart. | Zwei Zeilen: `isTerminalReplayStatus(res.status) && !isSessionExpired(res.error)` für das Präfix; `if (res.status === 429 \|\| isSessionExpired(res.error)) break;`. `isSessionExpired` existiert in `core/http/error-codes.ts:70`. |
| M4 | `core/auth/identity.ts:136-150`, `app/offline/offline-page-helpers.ts:76-79`, `OfflineClient.tsx:72-106` | Known-WGs (`manawg_known_wgs`) und Start-Entwurf sind kontolos. Nach Session-Ablauf (kein Wipe) + Login mit Konto B zeigt die Offline-Seite alle WG-Namen und Share-Codes von Konto A. `!identity.authUserId` gilt als „passt zu jedem Konto". | `KnownWg` bekommt `authUserId`; `visibleKnownWgs` filtert danach. Bei `SIGNED_IN` mit anderer User-ID als zuletzt `clearLocalAccountData()`. Klausel `!identity.authUserId \|\|` in `hasLocalIdentityFor` entfernen (nach Legacy-Ende). |
| M5 | `src/fixtures/api.ts:150-155`, `use-session-member.ts:56-65`, `WgContextProvider.tsx:71-77`, `use-join-wg.ts:66-90`, `OfflineClient.tsx:37-39`, `layout.tsx:95-103`, `middleware.ts:60-62,170-173`, `chat/page.tsx:29` | Fixture-Modus ist ein zweites Identitätsmodell im Prod-Bundle: Header als Identität, localStorage als Mitglied, eigenes Client-Verhalten (öffentlicher WG-Lookup). 43 von 52 E2E-Specs hängen daran, 363 `page.route`-Mocks; die echten Guards laufen im Standard-E2E nie. Auf Vercel nicht aktivierbar (`VERCEL=1`). | Siehe Phase 4. Kurzfristig: Kommentar in `member-header.ts:10-12` so fassen, dass er nicht als Vertrag gelesen wird. |
| M6 | `core/auth/client.ts:228-229`, `NeuClient.tsx:386-396`, `ChooseStep.tsx:87-110` | „Mit anderem Konto anmelden" steht direkt unter „Altes Profil wiederherstellen" und löscht per Präfix `manawg_` alle Legacy-Tokens, bevor das richtige Konto sie nutzen kann. Gewollt für geteilte Geräte, aber unangekündigt. Niemand schreibt Tokens mehr, Bestand schrumpft. | Mit Legacy-Enddatum erledigt. Bis dahin: Einträge mit `memberToken` im Wipe auslassen (eine Bedingung). |
| M7 | `app/api/wg/[code]/members/route.ts:179-186`, `claim/route.ts:78-83`, `LegacyAccountRecovery.tsx:19-20,70,82`, `core/infra/join-flow.ts:26` | Wer mit neuem Konto unter anderem Namen beitritt, bekommt eine zweite Zeile; Claim der alten scheitert danach dauerhaft (`account_already_linked`), Client zeigt generischen Text. Selber Name wird durch `name_taken` abgefangen, aber die Meldung nennt die Wiederherstellung nicht. Folgefehler: Legacy-Push-Abo auf demselben Endpoint sperrt das neue Konto mit `endpoint_owned` (`notification-writes.ts:85`). | Text in `join-flow.ts:26` ergänzen: „Warst du schon in dieser WG? Stelle dein altes Profil auf der Startseite wieder her." `account_already_linked` in `LegacyAccountRecovery` getrennt anzeigen. Kein Merge-Pfad (Legacy läuft aus). |
| M8 | `use-session-member.ts:94,121,152,169`, `identity.ts:18-26`, `components/wg/einstellungen/AccountSignOutSection.tsx:37-38` | Identität wird erst durch den zweiten GET in den Cache geschrieben; jeder WG-Aufruf zahlt einen Request, den das Layout schon beantwortet hat. `name` im Cache ist tot (Roster-Overlay korrigiert immer). `clearIdentity`+`forgetWg` nach `signOutSocialAccount` sind wirkungslos. | Mit M1 erledigt (Schreibpunkt im Provider), danach den Revalidate-GET auf Hintergrund-Refresh ohne Identitätswechsel reduzieren. `name` aus dem Schema streichen. Redundante Aufrufe löschen. |
| M9 | `openspec/changes/consolidate-architecture/proposal.md:64` vs. `core/infra/env.ts:82-92`, `README.md:53` | Proposal sagt „`MEMBER_SESSION_SECRET` becomes unused", Code nutzt es für Kalender-Feeds, Unsubscribe-Mails und Legacy-Beweis. Name suggeriert eine Session, die es nicht gibt. | Proposal-Satz korrigieren. Langfristig Rename `SIGNING_SECRET` mit `_PREVIOUS`-Rotation. Kommentare „recovery proofs" nach Legacy-Ende streichen. |
| M10 | `tests/security-guards-routes.test.ts:14,90-103,128-133`, dazu `security-bodies-idempotency.test.ts:181`, `storage-upload-routes.test.ts:147` | Tests lesen Quelltext (`readSource`, `source.includes(…)`), was `AGENTS.md:26` verbietet. `member-guards.test.ts:120` deckt „kein Token" ab, aber nicht den `authUserId`-Filter (Mock ignoriert `where`). | Source-Tests löschen. `includes('legacy-claim-proof')` als Regel `legacy-claim-seam` in `scripts/check-architecture.mjs`. Für den Filter: `where`-Argumente im Mock mitschneiden oder Verhaltenstest „fremder Nutzer sieht fremde Zeile nicht". |

### Niedrig

| Nr | Datei:Zeile | Problem | Fix |
|---|---|---|---|
| N1 | `core/http/error-codes.ts:61-67` + 7 Seitenlisten | `member_id_required` sendet der Server nie, `member_id_invalid` nur als 400-Feldfehler. Client klassifiziert beide als „Auth ungültig → Tritt der WG erneut bei". | Beide Codes aus `isAuthInvalidated` streichen. |
| N2 | `components/wg/use-members-refresh.ts:82` | Bei 409 `member_context_changed` wird `loadSessionMember(authUserIdRef.current)` gerufen → `{memberId: neu, authUserId: alt}` im Cache. Nur im Race vor dem BroadcastChannel-Event, heilt sich selbst. | `window.location.reload()` wie in `WgContextProvider.tsx:165`. |
| N3 | `use-members-refresh.ts:75-81` | Zweig für `not_a_member`/`member_deactivated` ist praktisch tot: `apiFetch` feuert vorher `MEMBERSHIP_LOST_EVENT`, `authGenerationRef` bricht `refreshMembers` in Z. 63 ab. | Zweig löschen. |
| N4 | `core/offline/offline-sync.ts:180-193` | `REAUTH_REQUIRED_ERROR`-Zweig unerreichbar: alle 7 Aufrufer übergeben `memberId`, Z. 160-162 überspringt fremde vorher. Letzter Grund, dass die Sync-Schicht `getIdentity` importiert. | `memberId` in `OfflineSyncOptions` Pflicht, Zeilen + Import löschen. |
| N5 | `components/auth/CredentialsAuth.tsx`, `PhoneAuthForm.tsx`, `core/auth/phone.ts`, `client.ts:22-54,145-161` | Phone/SMS ist in Prod aus, aber ausgeliefert; jeder `/neu`-Aufruf fragt `/auth/v1/settings` nur für den Tab. `requireEnabledProvider` vor Google-Login macht den Google-Start von diesem Request abhängig. | Phone-Pfad komplett löschen, `requireEnabledProvider` entfernen, `signInWithOAuth`-Fehler direkt melden. |
| N6 | `src/fixtures/mode.ts:13` | `\|\| process.env.NODE_ENV === 'test'` widerspricht dem Kommentar „every condition required"; `tests/fixture-mode.test.ts:77` erzwingt `production` und verdeckt es. Nichts hängt daran. | Zweig streichen. |
| N7 | `core/infra/env.ts:157-163` | Eigene Kopie der Fixture-Bedingung ohne `VERCEL`-Check; überspringt Pflicht-Env-Prüfung, `/api/health` wäre auf Preview fälschlich grün. Auth bleibt echt. | `env.VERCEL !== '1' &&` ergänzen oder auf `isE2EDbDownMode()` umstellen. |
| N8 | `core/guards/api-auth.ts:78-84`, `use-image-upload.ts:216`, `einstellungen/page.tsx:83` | Expected-Member-Header ist optional; zwei rohe `fetch`-Aufrufe senden ihn nicht. `not_a_member`/`member_deactivated` sind 401 statt 403 (Rest der Header-Zeit). | Gemeinsamer Wrapper für `/api/wg/**` und `/api/upload/**`. 403 für Autorisierungsfehler, Clients auf Status+Code. |
| N9 | `app/wg/[code]/chat/page.tsx:33-45` | Kommentar „RSC hat keine Member-Identität" stammt aus dem Header-Modell; Seite liest WG-Daten nur per Share-Code ohne Mitgliedschaftsprüfung (Layout läuft bei Client-Navigation nicht erneut). | `getWgViewer(code)` exportieren und nutzen. |
| N10 | `app/api/wg/[code]/members/[id]/claim/route.ts:85-91` | Kein `recordAuditEvent` beim Claim, anders als beim Beitritt. | `member.claimed`-Event nach Commit. |
| N11 | `core/db/schema.ts:82` | `auth_user_id` ohne FK; Auth-User außerhalb von `/api/account` gelöscht → tote Verknüpfung, Claim unmöglich (`member_already_linked`), kein Cleanup. | Cron-Prüfung oder Admin-Aktion „Verknüpfung lösen". Kein FK (anderes Schema). |
| N12 | `app/wg/[code]/layout.tsx:106,123`, `NeuClient.tsx:203-206`, `InviteStep.tsx:45` vs. `ShareWgCard.tsx:27-32` | `/wg/CODE` ohne Mitgliedschaft verliert den Beitritts-Intent (`deniedWgCode` wird nicht als `joinCode` vorbelegt). Zwei Einladungs-URL-Formen (`/neu?code=`, `/?code=`) mit verschiedenem Verhalten. | Layout leitet Nicht-Mitglieder auf `/neu?code=CODE`. Eine URL-Form. |
| N13 | `NeuClient.tsx:149-159`, `api/wg/mine/route.ts:21`, 4 Leser von `/api/wg/mine` | Push-Ziele beim Kontowechsel aus localStorage statt aus `/api/wg/mine` (liefert `memberId`, wird verworfen). Vier Parser mit unterschiedlicher Validierung. | `memberId` in `AccountWg`, ein gemeinsamer Fetch-Helper. |
| N14 | `use-membership-lost.ts:47-60`, `use-join-wg.ts:92,164`, `DangerZoneSection.tsx:53` | Share-Code-Rotation lässt alten `KnownWg` bei Nicht-Admins stehen. Join legt Known-WG mit Platzhalter „WG CODE" an. `leaveWg` räumt Queue und Fotos nicht auf. | `forgetWg` vor Redirect; `rememberWg` im Join entfernen; in `leaveWg` Aktionen + Pending-Images der WG löschen. |
| N15 | `app/registrieren/RegistrierenClient.tsx:39-49` | Ruft `startSocialLogin` direkt, ohne `markJustSignedIn()` → bei genau einer WG erscheint die Auswahl statt der Weiterleitung. | Wrapper aus `start-flow.ts` nutzen. |
| N16 | `core/auth/middleware.ts:80` + `core/auth/server.ts:41` | Zwei `getUser()`-Netzaufrufe pro API-Request; 429 von Supabase wirkt doppelt. | Nur bei Latenzdruck: Middleware für `/api/**` ohne `getUser()`. |
| N17 | `docs/architecture.md:147`, `docs/support-runbook.md:12`, `client.logout.test.ts:102`, 3 Tests mit Header-Literal | Toter Link auf `unify-idempotency-claims`; „member token" ohne Erklärung; tautologische Assertion auf nicht existierendes `memberToken`-Feld; Headername als String statt Konstante. | Pfad auf Archiv; „legacy recovery token (localStorage)"; Zeile löschen; `EXPECTED_MEMBER_ID_HEADER` importieren. |
| N18 | Begriffe | „identity" = Supabase-User, lokaler Cache und Legacy-Profil; „claim" = Legacy-Claim und Idempotency-Slot; „session" = Cookie, `sessionless`, `MEMBER_SESSION_SECRET`, `use-session-member`. | `StoredIdentity` → `CachedMember`; Glossar-Absatz in `docs/architecture.md` unter „Identity model". |

### Widerlegt (nicht umsetzen)

- **Claim nach Konto-Löschung + Admin-Reaktivierung als Lücke:** Claim-Route prüft `deactivatedAt`; Reaktivierung ist bewusste Admin-Entscheidung mit Warn-Dialog (`MembersSection.tsx:214`); Token-Inhaber ist der frühere Besitzer. Kein Fix.
- **Aktive Member ohne Konto als Zombies:** Neue aktive Zeilen ohne Konto können nicht mehr entstehen; Push geht an den Browser des Alt-Nutzers (kein Leck); Nachfolger-Sortierung folgt der Spec `harden-account-deletion`. Kein Fix. Nur `endpoint_owned` bleibt als Folge von M7.
- **`ownerAuthUserId` an jeder Queue-Aktion:** Join über den Cache greift nur im Offline-Zweig und fast immer nach echtem Sitzungs- oder Mitgliedschaftsverlust; Aktionen ohne `wgId` kommen real nicht vor. Mit M1 (Cache sofort gefüllt) ist das Problem erledigt.
- **Fixture-Modus auf Vercel aktivierbar:** `VERCEL=1` schließt ihn aus. `session-hint.ts:9` ist die sichere Richtung.

## 4. Umsetzungsplan

Reihenfolge: zuerst Nutzerwirkung, dann Entmischung, dann Löschen. Jede Phase ist ein eigener Commit und ein eigener Gate-Lauf (lint, typecheck, arch, knip, unit, betroffene e2e).

### Phase 1: Sichtbare Fehler (ca. 1 Tag)

Ziel: Kein Nutzer sieht mehr „abgemeldet", „kein Zugriff" oder „nicht wiederholbar", wenn das nicht stimmt.

| Schritt | Fund | Dateien |
|---|---|---|
| Identität einmal aus `initialIdentity` cachen | M1, M8 | `use-session-member.ts` (Effekt Z. 54-67) |
| `sessionEnded`-Zustand, eigene Karte, Banner sichtbar | M2 | `use-session-member.ts`, `WgContextProvider.tsx` |
| 401 beim Replay nicht terminal, Schleife abbrechen | M3 | `offline-sync.ts` (2 Zeilen) |
| Offline-Seite: retryable Auth-Fehler ≠ abgemeldet | H1 | `OfflineClient.tsx`, `identity.ts` (+`soleStoredAuthUserId`) |
| Logout: Sync-Versuch + Bestätigung bei Rest | H2 | `client.ts signOutSocialAccount`, `AccountSignOutSection`, `SignOutActions`, `NeuClient` |
| `member_id_*` aus `isAuthInvalidated` | N1 | `error-codes.ts` |

Verifikation: Unit-Tests für `isTerminalReplayStatus`-Pfad mit `auth_required`; manuell: WG anlegen → DevTools offline → neu laden (kein „WG nicht geladen"); Token ablaufen lassen (Supabase `expires_at` im localStorage zurücksetzen) → Offline-Seite zeigt Queue; Logout mit 1 gequeuter Aktion zeigt Dialog.

Risiko: gering, alles Client-seitig und additiv.

### Phase 2: Kontotrennung und Hygiene (ca. 1 Tag)

| Schritt | Fund | Dateien |
|---|---|---|
| `KnownWg.authUserId`, Filter, Wipe bei User-Wechsel | M4 | `identity.ts`, `offline-page-helpers.ts`, `OfflineClient.tsx`, `use-session-member.ts` |
| Tote Zweige löschen | N3, N4, M8 | `use-members-refresh.ts`, `offline-sync.ts`, `AccountSignOutSection.tsx` |
| 409 → reload | N2 | `use-members-refresh.ts` |
| Join-/Leave-Hygiene | N14, N12, N15, N13 | `use-join-wg.ts`, `use-membership-lost.ts`, `DangerZoneSection.tsx`, `layout.tsx`, `RegistrierenClient.tsx`, `use-account-wgs.ts` |
| Phone-Pfad löschen | N5 | `components/auth/*`, `core/auth/client.ts`, `phone.ts` |
| `name` aus Cache-Schema, Key → `manawg_member:` | M8, N18 | `identity.ts`, `e2e/support/helpers.ts` |

Verifikation: `client.logout.test.ts` anpassen; e2e `offline.spec`, `session-expired.spec`, `settings-access.spec`; knip meldet entfernte Exporte.

Risiko: Key-Umbenennung invalidiert bestehende Caches einmalig (harmlos, wird beim nächsten Laden neu geschrieben).

### Phase 3: Legacy-Claim beenden (0,5 Tag + Wartefrist)

1. **Prod zählen:**
   ```sql
   select count(*) from wg_members where auth_user_id is null and deactivated_at is null;
   ```
   Einziger Hinweis im Repo: „migrate the eight legacy memberships" (`openspec/changes/public-dashboard-entry/design.md:9`).
2. **Bei 0:** sofort Phase 3b. **Bei >0:** Frist 30 Tage, Hinweis in der Recovery-UI, Text-Fix M7, dann Admins bitten, Rest zu deaktivieren, oder einmalige Migration `update wg_members set deactivated_at = now() where auth_user_id is null and deactivated_at is null` plus `delete from push_subscriptions where member_id in (…)`.
3. **Phase 3b löschen:** `LegacyAccountRecovery.tsx`, Collapsible in `ChooseStep.tsx:44-110` + Props in `NeuClient.tsx`, `claim/route.ts`, `core/guards/legacy-claim-proof.ts`, in `identity.ts` `getLegacyIdentityCandidates`/`legacyClaimHeaders`/`LegacyIdentityCandidate`/`memberToken`, `LEGACY_CLAIM_*` in `member-header.ts`, Testblöcke `security-guards-routes.test.ts:109-135`, Mock `auth-outage-routes.test.ts:136`, Fixture `e2e/accessibility.spec.ts:696`, Doku `architecture.md:92-95`, `database-recovery.md:131`, README-Satz, Kommentare `env.ts:82-92`, `signing-secrets.ts:15`. `MEMBER_SESSION_SECRET` bleibt (Kalender, Unsubscribe); Proposal-Satz korrigieren (M9). `authUserId` im Cache-Schema Pflicht, `!identity.authUserId`-Klausel weg.
4. **Behalten:** `auth_user_id` nullable (Konto-Löschung setzt null), partielle Indizes, `assertAccountCanAcquireMembership`.

Verifikation: knip grün (keine toten Exporte), `check-architecture` mit neuer Regel `legacy-claim-seam` bis zur Löschung, danach Regel entfernen.

### Phase 4: Fixture-Modus ersetzen (2 bis 3 Tage, schrittweise)

Ziel: Null Test-Zweige im Produktionscode; E2E prüft die echten Guards.

1. CI: `services: postgres` + `pnpm db:migrate` + Seed (WG, 2 Member mit `auth_user_id`).
2. Auth: Supabase CLI (`supabase start`) mit Test-User per Admin-API, Session-Cookie als Playwright `storageState` im `globalSetup` (Muster existiert in `e2e/support/preview-global-setup.ts`). Alternative ohne Docker: GoTrue-Stub auf `127.0.0.1`, der `GET /auth/v1/user` beantwortet, wie `AUTH_UI_E2E` in `playwright.config.ts:52-53` es schon tut.
3. Specs einzeln umstellen: `setupMember` → `storageState`; `page.route`-Mocks (363) durch echte Aufrufe ersetzen, eine Spec pro Commit. Reihenfolge: `security`, `settings-access`, `public-entry`, `session-expired`, dann der Rest.
4. Danach löschen: `src/fixtures/*` (571 Zeilen), `isE2EDbDownMode`, `isClientFixtureMode`, `sessionless`-Props in `WgContextProvider`, `use-session-member`, `OfflineClient`, `use-join-wg`, `NeuClient`; Zweige in `middleware.ts`, `layout.tsx`, `chat/page.tsx`, `neu/page.tsx`, `offline/page.tsx`; `session-hint.ts:9`; `env.ts:157-173`; `fixture-seam`-Regel in `check-architecture.mjs`; Env `NEXT_PUBLIC_DB_DOWN`, `E2E_FIXTURE_MODE`, `NEXT_PUBLIC_E2E_FIXTURE_MODE`; dreifachen Env-Block in `playwright.config.ts`.
5. Zwischenschritte, falls Phase 4 später kommt: N6, N7 (je eine Zeile), Kommentar `member-header.ts:10-12`.

Risiko: CI-Minuten (Billing-Sperre beachten, Memory `manawg CI durch Billing blockiert`); Docker-Supabase auf Runnern nicht geprüft. Der GoTrue-Stub ist der billigere Weg.

### Phase 5: Rest (nach Bedarf)

N8 (Wrapper + 403), N9, N10, N11, N16, N17, N18-Glossar, M10 (Source-Tests → Arch-Regel).

## 5. Was am Ende weg ist

| Was | Bedingung |
|---|---|
| `memberToken`, `getLegacyIdentityCandidates`, `legacyClaimHeaders`, `LEGACY_CLAIM_*`, `legacy-claim-proof.ts`, `claim/route.ts`, `LegacyAccountRecovery.tsx` | Phase 3 nach Prod-Zählung = 0 |
| `name` im Cache, `hasLocalIdentityFor`-Klausel für Einträge ohne `authUserId`, `REAUTH_REQUIRED_ERROR`-Zweig, `use-members-refresh.ts:75-81`, redundante `clearIdentity`/`forgetWg` nach Logout | Phase 2 |
| Phone/SMS-Pfad, `requireEnabledProvider` | Phase 2 |
| `member_id_required`/`member_id_invalid` in Auth-Listen (8 Dateien) | Phase 1 |
| `src/fixtures/*`, `sessionless`, `isE2EDbDownMode`, `setupMember`, Fixture-Env | Phase 4 |
| Source-lesende Tests (3 Dateien) | Phase 5, ersetzt durch Arch-Regel |
| `MEMBER_SESSION_SECRET` | bleibt; nur umbenennen, wenn Rotation ohnehin ansteht |

## 6. Nachtrag 2026-10-11: Einstieg und installierte App

Zwei Rückmeldungen nach Phase 1, beide geprüft:

**„WG erstellen ohne Login"**: Auf Prod (Stand 76c5ddf4) ist das Erstellen serverseitig gesperrt (`POST /api/wg` → 401 ohne Session) und auch die Oberfläche zeigt vor dem Formular die Anmeldung. Der Eindruck entsteht durch die Reihenfolge: Die Gast-Startseite führte mit „WG erstellen" (→ `/neu?action=create`), erst dann kam „Melde dich an, danach erstellst du deine neue WG". Das ist der Rest der alten Denkweise „WG zuerst, Konto später". Fix (umgesetzt): Für Gäste heißt der Hauptknopf „Konto erstellen" (→ `/registrieren`), die Anmeldung bleibt im Kopf der Seite; WG erstellen oder beitreten gibt es erst nach der Anmeldung in `/neu`. Einladungslinks (`?code=`) behalten ihre Absicht über Anmeldung und Registrierung hinweg, sonst ginge der Code verloren. `WgWelcome.tsx`, Live-Spec `public-entry-live.spec.ts` angepasst.

**„Nach der Installation nicht angemeldet"**: Auf dem iPhone hat eine Home-Bildschirm-App einen eigenen Speicher (Cookies, localStorage), getrennt von Safari. Eine Anmeldung in Safari erreicht die installierte App daher nie; das ist Plattformverhalten, nicht die App. Android (WebAPK) und Desktop-Chrome teilen das Browserprofil, dort bleibt die Sitzung erhalten. Die Supabase-Cookies sind 400 Tage gültig (`@supabase/ssr`-Default, `authCookieOptions` überschreibt nur `path`/`sameSite`/`secure`). Fix (umgesetzt): iOS-Installationsanleitung bekommt Schritt 4 „App öffnen und einmal anmelden"; die Anmeldeseite zeigt in der installierten iOS-App einen Hinweis, warum einmal neu angemeldet wird (`StartNotices.tsx`, erkannt über `display-mode: standalone` + iOS-Gerät). Nicht möglich: Sitzung in die iOS-App übertragen (kein geteilter Speicher, `start_url` ist statisch, Token in der URL wäre dauerhaft im Lesezeichen).

Offen, wenn Android/Desktop trotzdem abgemeldet startet: dann liegt es nicht an der Installation, sondern an der Sitzung selbst (Refresh-Token ungültig, z. B. nach Logout in einem anderen Tab, oder Konto-Löschung). Dazu braucht es ein konkretes Gerät und den Netzwerk-Log von `/api/wg/mine`.

## 7. Zielbild Anmeldung und Zugang (2026-10-11, nach Rückmeldung)

Die echten Lücken, nach Wirkung sortiert:

| # | Lücke | Folge |
|---|---|---|
| L1 | Der WG-Code ist zugleich URL-Slug (`/wg/CODE`), dauerhaftes Beitrittsgeheimnis und Einladung. Kein Ablauf, keine Freigabe durch die WG, nur ein globaler Schalter `joiningEnabled`. | Wer die URL je gesehen hat (Screenshot, Verlauf, weitergeleiteter Link), kann jederzeit beitreten. Ausgezogene behalten den Schlüssel. |
| L2 | Session-Cookies sind nicht HttpOnly, weil der Browser-Client sie liest und per `document.cookie` erneuert. | XSS könnte die Sitzung stehlen. Safari (nicht installiert) löscht skriptgeschriebene Cookies nach 7 Tagen ohne Besuch: „plötzlich abgemeldet". |
| L3 | Nur Google oder E-Mail+Passwort. Kein Anmeldecode per E-Mail, Telefon-Pfad tot. | In der installierten iPhone-App muss ein Passwort getippt werden; Bestätigungs- und Reset-Links öffnen Safari, nicht die App. |
| L4 | Konto-Zustand liegt in vier Rollen in einem localStorage-Key, Legacy-Claim und Fixture-Modus leben im Prod-Bundle (Abschnitt 3, Phasen 2–4). | Fehlerquellen, mehr Code, mehr Angriffsfläche. |
| L5 | iOS-Home-Bildschirm-App hat eigenen Speicher. | Einmalige Neuanmeldung in der App ist unvermeidbar; sie muss nur schnell sein (L3). |

Zielbild in einem Satz: **Konto zuerst, Zugang per Einladung mit Ablauf und Freigabe, Sitzung nur serverseitig, Anmeldung ohne Passwort möglich.**

### Paket A: Einladungen statt Dauer-Code (ca. 2 Tage, Migration)

- Neue Tabelle `wg_invites` (id, wg_id, token 128 Bit, created_by, expires_at 7 Tage, max_uses 1 oder n, used_count, revoked_at). Einladung erzeugen und widerrufen nur für Mitglieder; Liste in den Einstellungen.
- Beitritt nur mit gültigem Token (`/einladung/<token>`), nicht mehr mit dem Code. Optional Freigabe: `wgs.join_approval` (bool); dann landet der Beitritt als `pending` und ein Mitglied bestätigt (Push/Mail E-Vorlage vorhanden).
- Der 8-stellige Code bleibt URL-Slug und Anzeige, verliert seine Geheimnis-Rolle. `joiningEnabled` entfällt, `GET /api/wg/[code]` ohne Mitgliedschaft bleibt 404.
- Nötig in der UI: `InviteStep` teilt den Token-Link, `PublicApp`/`/neu` nehmen `?invite=` statt `?code=`, Beitrittsseite zeigt WG-Name (Token erlaubt den Blick vorab).

### Paket B: Sitzung nur auf dem Server, HttpOnly (ca. 1,5 Tage)

- Passwort-Login, Registrierung, Reset, OTP-Verify und Logout laufen über Route-Handler (`/auth/sign-in` usw.) mit `createSupabaseServerClient`; Google-OAuth startet serverseitig (`signInWithOAuth` mit `skipBrowserRedirect` auf dem Server, Redirect-URL zurückgeben).
- Cookies dann `httpOnly: true`; Refresh ausschließlich in der Middleware. Browser-Client entfällt bis auf nichts; `use-session-member` liest den Zustand über `/api/wg/mine` bzw. die Member-Antwort, `OfflineClient` über den lokalen Cache (`soleStoredAuthUserId`), `session-hint` über ein zweites, nicht-sensibles Cookie `manawg_signed_in=1`.
- Gewinn: kein Session-Diebstahl per Skript, kein 7-Tage-Verlust in Safari, kein Client-Refresh-Rennen zwischen Tabs.

### Paket C: Anmeldecode per E-Mail und Passkeys (ca. 1 Tag + Supabase-Konfiguration)

- „Code per E-Mail" als erste Option neben Google: `signInWithOtp({ email })` + `verifyOtp({ type: 'email' })`, 8-stelliger Code wie in der bestehenden Anmeldecode-Mail. Funktioniert in der installierten App, kein Link-Sprung nach Safari, kein Passwort.
- Passwort wird optional (Konto-Einstellung), Telefon-Pfad löschen.
- Passkeys erst, wenn Supabase sie als ersten Faktor anbietet; bis dahin nicht bauen.

### Paket D: Aufräumen (Phasen 2–4 aus Abschnitt 4, ca. 4 Tage)

Unverändert: Kontotrennung im Cache, Legacy-Claim nach Prod-Zählung löschen, Fixture-Modus durch echte Test-Session ersetzen.

### Reihenfolge

C → B → A → D. C ist klein und nimmt den iPhone-Schmerz sofort. B macht die Sitzung sicher und stabil. A ändert das Produkt (Einladung mit Ablauf, Freigabe) und braucht Migration plus Kommunikation an bestehende WGs (alte Code-Links zeigen dann „Bitte um neue Einladung").

### Paket B: Stand 2026-10-11 (lokal umgesetzt)

- Alle Auth-Vorgänge laufen über `app/api/auth/*` (sign-in, sign-up, resend, password-reset, password, code-request, code-verify, oauth-start, identity-link, identities, sign-out) mit `createSupabaseServerClient`. Supabase-Fehlercodes stehen 1:1 in `code`. `core/auth/client.ts` behält seine Signaturen und ruft nur noch diese Routen auf; kein Supabase-Client mehr im Browser.
- Session-Cookies sind `HttpOnly` (`authCookieOptions`). Das Hint-Cookie `manawg_signed_in=1` (nicht HttpOnly, 400 Tage) wird überall gesetzt und gelöscht, wo der Server Session-Cookies schreibt (`createSupabaseServerClient`, Middleware-Refresh, Konto-Löschung, sign-out). Die Middleware migriert bestehende Sitzungen einmalig: fehlt der Hint, schreibt sie die Token-Cookies HttpOnly neu und setzt den Hint.
- `use-session-member` hat keinen Auth-Listener mehr; es prüft beim Mount und bei `visibilitychange` über `GET /api/wg/[code]` (liefert jetzt `currentMember.authUserId`). `OfflineClient` nutzt `getLocalAccount` und `/api/wg/mine`.
- Bekannte Grenze: Supabase begrenzt Anmeldungen pro IP; der Server leitet die Client-IP als `X-Forwarded-For` weiter, ob Supabase sie dafür nutzt, ist nicht geprüft. Dazu ein eigener Limiter `authAttemptLimiter` (20 / 5 min / IP).

## 8. Stand 2026-10-11 nach Umsetzung (lokal, nicht gepusht)

| Commit | Inhalt |
|---|---|
| 7419f861 | Phase 1 (Sitzung getrennt von Mitgliedschaft, Offline-Replay, Logout-Sync) |
| 95485495 | Einstieg: Konto zuerst, iOS-Hinweis |
| 2854e8b6 | Name bei der Registrierung, Code per E-Mail (Paket C), Phone-Pfad weg, `manawg_identity` weg (Phase 2) |
| 31d49363 | Paket B (HttpOnly, `/api/auth/*`) und Paket A (`wg_invites`, Migration 0026) |

Offen:
- **Phase 3, Server-Claim-Pfad** (`claim/route.ts`, `legacy-claim-proof.ts`, `LEGACY_CLAIM_*`): kein Aufrufer mehr, Löschung wartet auf die Prod-Zählung `select count(*) from wg_members where auth_user_id is null and deactivated_at is null`.
- **Phase 4, Fixture-Modus** durch echte Test-Session ersetzen (2–3 Tage, CI-Umbau).
- **Vor dem Prod-Release:** Migration 0026 manuell einspielen (`supabase db query --linked`), Supabase-Vorlage „Magic Link" zeigt `{{ .Token }}` (8 Stellen, versioniert in `supabase/templates/magic_link.html`), E-Mail-OTP-Länge im Supabase-Projekt muss 8 sein (`EMAIL_CODE_LENGTH`), bestehende WGs über den Wechsel auf Einladungslinks informieren (Text in Abschnitt 7 / Commit 31d49363).

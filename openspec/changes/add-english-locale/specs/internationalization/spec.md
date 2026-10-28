## Purpose

Let every person use ManaWG in German or English, with their own choice applied to the interface, server-generated messages and formatting, while German output stays unchanged.

## ADDED Requirements

### Requirement: Locale is resolved per request

The app SHALL render in the locale from the `manawg_locale` cookie when it holds `de` or `en`. Without a valid cookie it SHALL use the first `Accept-Language` tag (by q value) whose primary subtag is `de` or `en`, and otherwise German. URLs SHALL NOT carry a locale. The document SHALL declare `lang="de"` for German and `lang="en-GB"` for English.

#### Scenario: Cookie wins over the browser
- **WHEN** a browser that prefers `de-DE` sends `manawg_locale=en`
- **THEN** the page SHALL render in English with `lang="en-GB"`

#### Scenario: English browser on first visit
- **WHEN** a browser without the cookie sends `Accept-Language: en-GB,en;q=0.9`
- **THEN** the page SHALL render in English

#### Scenario: Unknown language
- **WHEN** a request carries an invalid cookie and `Accept-Language: fr-FR`
- **THEN** the page SHALL render in German

### Requirement: German output does not change

Introducing English SHALL NOT change any German text, metadata, JSON-LD, OG data or manifest output. OG locale, JSON-LD `inLanguage`, OG images and the manifest SHALL stay German in every locale.

#### Scenario: German head is identical
- **WHEN** `/`, `/neu`, `/registrieren` and `/entdecken/<module>` render in German
- **THEN** their server `<head>` SHALL equal the output before this change, apart from per-request nonces and build hashes

### Requirement: The language choice persists for the person

Switching the language SHALL set the `manawg_locale` cookie for one year. When the person is signed in, the server SHALL store the locale on every membership of that account and in the account metadata. `PATCH /api/account` SHALL accept only `de` or `en`, SHALL answer `400` with a code for other values and `401` without a session. Failure to store the choice SHALL NOT undo the switch on this device. Creating, joining or claiming a membership SHALL store the request locale.

#### Scenario: Switch while signed in
- **WHEN** a signed-in member switches to English
- **THEN** all their memberships SHALL store `en` and the page SHALL reload in English

#### Scenario: Invalid locale
- **WHEN** a client sends `PATCH /api/account { "locale": "fr" }`
- **THEN** the server SHALL answer `400`

#### Scenario: Switch while signed out
- **WHEN** a visitor on the entry page switches to English
- **THEN** the cookie SHALL be set and later pages SHALL render in English

### Requirement: Server text uses the recipient's language

Push notifications, monthly statements, reminder mails and unsubscribe pages SHALL use the stored locale of the recipient membership. Mails and pages answering a request SHALL use the request locale. A push to members with different locales SHALL give each member their own language.

#### Scenario: Mixed WG push
- **WHEN** an expense notifies one member with locale `de` and one with `en`
- **THEN** the first SHALL receive German and the second English text with the amount formatted for their locale

### Requirement: Formatting and amount input follow the locale

Dates, numbers and currency SHALL be formatted with `de-DE` for German and `en-GB` for English. WG day boundaries SHALL stay in `Europe/Berlin`. Amount input SHALL accept `12,50` and `12.50` as 12.50 in both locales; a three-digit tail after a single separator SHALL be read as grouping in the separator's locale convention and SHALL be rejected otherwise. English CSV export SHALL use `,` as separator and `.` as decimal point; German CSV SHALL stay unchanged.

#### Scenario: English amount with grouping
- **WHEN** an English user enters `1,234.50`
- **THEN** the amount SHALL be 123450 cents

#### Scenario: German amount unchanged
- **WHEN** a German user enters `1.234,56`
- **THEN** the amount SHALL be 123456 cents

### Requirement: Display text is not stored or used as logic

New code SHALL NOT compare, parse or store localized display text. API responses SHALL carry codes or keys, not localized fallback names; a missing person name SHALL be `null` and clients SHALL show a localized "unknown" label.

#### Scenario: Unknown member name
- **WHEN** an API response refers to a member without a stored name
- **THEN** the name field SHALL be `null`

### Requirement: Both languages stay complete

The build SHALL fail when a German catalog key has no English counterpart or vice versa, when a message has invalid ICU syntax, or when placeholder names differ between the languages. A ratchet check SHALL reject new hard-coded UI text in source files.

#### Scenario: Missing English key
- **WHEN** a German message is added without an English one
- **THEN** typecheck and the catalog test SHALL fail

#### Scenario: New hard-coded label
- **WHEN** a component adds a literal German button label
- **THEN** the architecture check SHALL fail

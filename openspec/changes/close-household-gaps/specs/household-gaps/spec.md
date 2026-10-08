## ADDED Requirements

### Requirement: An expired session is explained once and recoverable

The system SHALL show one banner on every WG screen when a request is answered with `auth_required`, linking to sign-in with the current page as return target. A sign-in redirect issued by the WG layout SHALL carry the requested page of that WG.

#### Scenario: Session expires while a form is open

- **WHEN** a request from a WG page returns 401 `auth_required`
- **THEN** the page shows the session-expired banner with a link to `/neu?next=<current page>`

### Requirement: A hanging navigation falls back to the offline page

The service worker SHALL answer a navigation that the network has not answered within 8 seconds with the cached page or the offline page.

#### Scenario: Bad connection

- **WHEN** a navigation request does not complete within 8 seconds
- **THEN** the cached page for that URL, else the offline page, is served

### Requirement: A picture can be sent in chat

The composer SHALL allow attaching one uploaded picture and sending it with or without text; a picture that is still waiting for upload MUST NOT be sent.

#### Scenario: Picture only

- **WHEN** a member attaches an uploaded picture and sends
- **THEN** the message is posted with `imageUrl` and an empty body

### Requirement: Unreferenced uploads are removed

The maintenance run SHALL remove stored pictures that are older than 14 days, not referenced by any expense, announcement or chat message, and not already queued for deletion.

#### Scenario: Abandoned form

- **WHEN** a picture was uploaded for a form that was never saved and 14 days passed
- **THEN** the next sweep of its WG deletes the object

### Requirement: Chores without assignee are reminded

A due chore whose assignee moved out SHALL be announced to every member who wants chore notifications, at most once a day.

#### Scenario: Assignee moved out

- **WHEN** a chore without assignee is due and has not been reminded for 18 hours
- **THEN** one push goes to the WG members with chore notifications on

### Requirement: Imports keep identical purchases and can be undone

The import SHALL skip the n-th identical row of a file only while the WG already holds n expenses with the same date, description, amount, currency and payer. The member who imported, or an admin, SHALL be able to remove all expenses of an import until a share other than the payer's own is settled.

#### Scenario: Two coffees on one day

- **WHEN** a file contains the same purchase twice and the WG holds none
- **THEN** both are imported

#### Scenario: Undo after a payment

- **WHEN** any import share has been settled
- **THEN** undo is refused with `import_settled`

### Requirement: One date of a series can change on its own

Removing or changing one occurrence of a repeating event SHALL leave the other occurrences unchanged and happen in one transaction; only the creator or an admin MAY do it, and only for a date the series really produces.

#### Scenario: Remove a single date

- **WHEN** the creator removes the occurrence of 12 October
- **THEN** the series lists every other date and the rule holds `EXDATE=<that start>`

### Requirement: Signing secrets can rotate

Calendar feed URLs and legacy recovery proofs SHALL verify against `MEMBER_SESSION_SECRET` and every secret in `MEMBER_SESSION_SECRET_PREVIOUS`, while new signatures use only the current one.

#### Scenario: Rotation

- **WHEN** the old secret is moved to the previous list
- **THEN** feed URLs issued earlier keep working

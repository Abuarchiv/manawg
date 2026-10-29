# offline-platform Specification

## Purpose
Keep offline behavior and shared UI primitives honest.

## Requirements

### Requirement: Backoff reflects real failures

Plain connection failures (no status, fetch error, timeout) SHALL NOT increase attempts or the backoff of a queued action, and automatic sync SHALL wait while the browser is offline. HTTP and sign/upload errors SHALL keep the backoff.

#### Scenario: Offline for a long time
- **WHEN** a queued action fails only because the device is offline
- **THEN** its attempt count SHALL NOT grow

### Requirement: Offline pages do not offer dead links

On the offline page the "Zurück zu" button and known-WG links SHALL be disabled with a hint while the browser is offline. The queue card SHALL list the newest actions first.

#### Scenario: Offline hero button
- **WHEN** the browser is offline
- **THEN** the WG button SHALL be disabled and a hint SHALL be shown

### Requirement: Controlled components follow their parent

Checkbox, Switch and Collapsible SHALL show the value of a provided prop, so a rejected change does not leave the control out of sync.

#### Scenario: Parent rejects a change
- **WHEN** a parent keeps a controlled value unchanged after a toggle
- **THEN** the control SHALL display the unchanged value

### Requirement: Keyboard and error pages are accessible

On-screen keyboard detection SHALL be one shared hook used by the bottom navigation and the expense form. The WG error page heading SHALL receive focus on mount. The root layout SHALL NOT set a global canonical URL.

#### Scenario: Error page opens
- **WHEN** the WG error page renders
- **THEN** its heading SHALL be focused

### Requirement: Edits to a sent action are held for review

Removing the attachment of a queued action that already went out once (its outcome is unknown) SHALL hold the action for a server check instead of resending it with the edit, because the server replays by idempotency key and would drop the edit.

#### Scenario: Attachment removed after a lost response
- **WHEN** a queued expense was sent, the response was lost, and the member removes its attachment
- **THEN** the action SHALL need a server check and SHALL NOT be resent

### Requirement: Queued actions do not depend on display text

Queued offline actions SHALL record review states (server check, missing image, removed image, no connection) as flags and their error as a message key, and SHALL render the text in the current language. Actions stored before this change with German error text SHALL keep their behaviour and show their stored text.

#### Scenario: Legacy queued action
- **WHEN** the queue holds an action whose stored error starts with the German server-check prefix
- **THEN** it SHALL be treated as needing a server check, as before

#### Scenario: Language switch with a queued error
- **WHEN** a new queued action failed and the person switches to English
- **THEN** its error SHALL be shown in English

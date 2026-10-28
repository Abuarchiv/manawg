## ADDED Requirements

### Requirement: Queued actions do not depend on display text

Queued offline actions SHALL record review states (server check, missing image, removed image, no connection) as flags and their error as a message key, and SHALL render the text in the current language. Actions stored before this change with German error text SHALL keep their behaviour and show their stored text.

#### Scenario: Legacy queued action
- **WHEN** the queue holds an action whose stored error starts with the German server-check prefix
- **THEN** it SHALL be treated as needing a server check, as before

#### Scenario: Language switch with a queued error
- **WHEN** a new queued action failed and the person switches to English
- **THEN** its error SHALL be shown in English

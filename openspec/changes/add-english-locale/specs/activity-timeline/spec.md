## ADDED Requirements

### Requirement: Feed renders in the reader's language

New activity entries SHALL be rendered in the reader's language, including the second-person form for the reader's own actions. Entries written before this change SHALL show their stored German text. The stored summary of new entries SHALL stay German and identical to today's wording, and audit metadata SHALL NOT contain post or chat content.

#### Scenario: English reader sees new entry
- **WHEN** an English reader opens the feed after a flatmate added an expense
- **THEN** the entry SHALL be in English

#### Scenario: Old entry
- **WHEN** an English reader opens an entry stored before this change
- **THEN** the stored German text SHALL be shown

## ADDED Requirements

### Requirement: Transactional mails are sent at most once

Every mail of kinds welcome, invitation, reminder, digest and account_deleted SHALL be recorded in `mail_log` with a unique dedupe key before the provider is called, and a second attempt with the same key SHALL send nothing while the first is sent or in flight.

#### Scenario: Repeated callback
- **WHEN** the auth callback runs twice for the same new account
- **THEN** exactly one welcome mail is sent

### Requirement: Invitation by e-mail stores no address

The invitation endpoint SHALL send the share code and join link to the given address, SHALL refuse while joining is disabled, SHALL rate-limit per member, and SHALL persist only a hash of the address.

#### Scenario: Same address twice on one day
- **WHEN** a member invites the same address twice within a Berlin day
- **THEN** the second call answers `duplicate` and no second mail is sent

### Requirement: Digest only for members without push and only with content

The daily digest SHALL go to active members with `push_opt_in = false`, `notify_digest_email = true` and a confirmed address, SHALL respect the per-area switches, and SHALL not be sent when no item remains.

#### Scenario: Quiet day
- **WHEN** nothing is due, booked, scheduled for tomorrow or low in stock
- **THEN** no digest row is written and no mail is sent

### Requirement: Reminder mail stands in for push

When a reminder is sent to a debtor without push, the reminder SHALL also be mailed with the open items the creditor paid, once per reminder row, with an unsubscribe link that turns `notify_reminders` off.

#### Scenario: Debtor has push
- **WHEN** the debtor has `push_opt_in = true`
- **THEN** only the push is sent and no reminder mail row is written

### Requirement: Unsubscribe links name their kind

Unsubscribe tokens SHALL verify to a member and a kind; the POST SHALL disable only that kind for every membership of the account.

#### Scenario: Digest link
- **WHEN** a member submits the unsubscribe form from a digest mail
- **THEN** `notify_digest_email` is false for all memberships of the account and the statement preference is unchanged

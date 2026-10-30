# monthly-statement-email Specification

## Purpose
Mail each active member one monthly statement per WG that matches the in-app statement, only when it is relevant and the member can and wants to receive it.

## Requirements

### Requirement: Monthly statement is mailed once per member, WG and month

On Berlin day 1 of a month the system SHALL send each eligible member one statement mail per WG for the previous Berlin calendar month, and SHALL never send a second mail for the same member and month.

#### Scenario: Normal month
- **WHEN** WG Kastanienallee has 47 expenses in September and Lina took part
- **THEN** Lina receives "September ist abgerechnet" on 1 October with Gesamt, Ausgaben, Dein Anteil and her status

#### Scenario: Cron runs twice or crashes mid-run
- **WHEN** the cron is invoked again on the same day or after a crash
- **THEN** members already marked `sent` receive nothing, unsent members are mailed exactly once
- **AND** a row whose result was never written down (`sending` for over 15 minutes) is closed as unconfirmed and never resent

#### Scenario: Provider error or daily quota reached
- **WHEN** Resend rejects a mail or the daily quota is exhausted
- **THEN** the row stays `failed`/`pending` and is retried on days 2–5; after day 5 it stays failed and is logged
- **AND** a request that timed out (Resend) or an SMTP socket that timed out is unconfirmed (the provider may have accepted it) and is not retried automatically
- **AND** a rejected batch is resent mail by mail for at most 40 seconds; the mails not reached stay `pending` and are retried on days 2–5

#### Scenario: Member in two WGs
- **WHEN** Mira is a member of two WGs that both had expenses
- **THEN** Mira receives two mails, each naming its WG

### Requirement: Only relevant mail is sent

The system SHALL skip a member when the mail would carry no actionable information.

#### Scenario: Quiet month
- **WHEN** the WG has no EUR expenses in the month
- **THEN** no member of that WG receives a mail

#### Scenario: Member did not take part
- **WHEN** a member neither paid nor owes a share that month
- **THEN** that member receives no mail

#### Scenario: Single participant
- **WHEN** only one member took part in the month
- **THEN** no mail is sent for that WG

### Requirement: Recipients are reachable and consenting

The system SHALL mail only active members with an Auth account, a confirmed e-mail address and `notify_statement_email` enabled.

#### Scenario: Member without account or with unconfirmed address
- **WHEN** the member has no linked Auth user or the address is unconfirmed
- **THEN** the member is skipped with reason `no_email`

#### Scenario: Address lookup fails or is unconfigured
- **WHEN** Supabase Auth does not answer for a member (timeout, 429, 5xx) or the service-role configuration is missing
- **THEN** no ledger row is written for that member and the next run decides again; a missing configuration fails the run

#### Scenario: Skipped member qualifies on a later day
- **WHEN** a member skipped on day 1 confirms the address, switches the preference on, or the WG books a back-dated expense, before day 6
- **THEN** the next run queues and mails the member

#### Scenario: Moved-out or deleted member
- **WHEN** the member is deactivated or the account was deleted
- **THEN** the member is skipped; the other members' statements still count that member's expenses

#### Scenario: Unsubscribe
- **WHEN** a member uses the unsubscribe link or the List-Unsubscribe one-click action
- **THEN** `notify_statement_email` becomes false without login and no later statement mail is sent for any WG of the same account; Einstellungen shows the switch off and can turn it back on

#### Scenario: Invalid unsubscribe link
- **WHEN** the unsubscribe link or the one-click action carries a truncated or foreign token
- **THEN** the answer is status 400 with an HTML page in the request locale that points to Einstellungen, and nothing changes

### Requirement: Mail content matches the in-app statement

The figures in the mail SHALL be computed by `buildMonthlyStatement` at send time, and the button SHALL open the in-app statement for the same month.

#### Scenario: Settled month
- **WHEN** every share of the month is settled or the month's debts between members cancel out exactly
- **THEN** the status reads "Alles ausgeglichen 0,00 €" in green

#### Scenario: Open balance
- **WHEN** the member owes money for the month
- **THEN** the status shows "Du schuldest" with the amount in red and lists the member's transfers

#### Scenario: Expense added after sending
- **WHEN** an expense for the month is added after the mail went out
- **THEN** no new mail is sent; the linked in-app statement shows the updated figures

### Requirement: Non-production never sends

The system SHALL send statement mails only from the production deployment.

#### Scenario: Preview deployment
- **WHEN** the cron runs with `VERCEL_ENV` other than `production`
- **THEN** mails are rendered and logged but not sent, and no ledger row is written

#### Scenario: Production without mail key
- **WHEN** the cron runs in production and `RESEND_API_KEY` is missing
- **THEN** the run fails loudly instead of recording anything

#### Scenario: Recipient allowlist
- **WHEN** `STATEMENT_EMAIL_ALLOWLIST` is set
- **THEN** every mail the app sends itself (statement, invitation, reminder, welcome, account deleted) goes only to the listed addresses, in any environment; an invitation to another address answers 503 `mail_unavailable`

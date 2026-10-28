# member-settings Specification

## Purpose
Keep profile, member management and notification settings clear and durable.

## Requirements

### Requirement: Owners rename members

An owner SHALL be able to rename members; other members SHALL receive `403 not_owner`. Names SHALL be unique case-insensitively including moved-out members (`409 name_taken`) and the change SHALL be audited as `member.renamed`. The members list SHALL show admin badges.

#### Scenario: Name taken
- **WHEN** an owner renames a member to an existing name in another case
- **THEN** the server SHALL answer `409 name_taken`

### Requirement: Push opt-out is respected

Turning push off on a device SHALL set a local opt-out that survives sign-out and prevents automatic resubscription until the member turns push on again. The settings SHALL show when push is not active on this device or blocked by the browser. An endpoint owned by another account SHALL be replaced by a fresh subscription.

#### Scenario: Sign out and back in
- **WHEN** a member opted out, signs out and signs in
- **THEN** push SHALL stay off

### Requirement: Join and rotation settings are consistent

After toggling joins the layout SHALL refresh. Rotating the invite code SHALL NOT re-enable joining and SHALL tell the member when joining is off. Quiet hours SHALL explain Berlin time and urgent exceptions and SHALL reject equal start and end.

#### Scenario: Rotate with joining off
- **WHEN** an admin rotates the code while joining is off
- **THEN** joining SHALL remain off and a notice SHALL say so

### Requirement: Images are converted and queues confirmed

HEIC/HEIF and large photos SHALL be converted to JPEG (at most 2048 px) before upload; undecodable HEIC SHALL be refused with a message. Uploads SHALL time out after 60 seconds and stop on permanent 4xx errors. Discarding queued offline actions SHALL require confirmation and remove the pending image.

#### Scenario: Discard
- **WHEN** a member discards the queue
- **THEN** a confirmation with a summary SHALL appear first

### Requirement: Members choose their language

The profile settings SHALL offer a language choice between "Deutsch", "English" and "System", the languages shown in their own language. "System" SHALL clear the stored choice so the device language decides again, and it SHALL be selected while no choice is stored. While the device language decides, the account language for push and mail SHALL follow it. The choice SHALL be disabled while offline. Changing it SHALL apply to the whole app after a reload.

#### Scenario: Switch to English in settings
- **WHEN** a member selects "English" in the profile settings
- **THEN** the app SHALL reload in English and the settings SHALL show "English" as selected

#### Scenario: Offline
- **WHEN** the device is offline
- **THEN** the language choice SHALL be disabled with the offline hint

#### Scenario: Back to the device language
- **WHEN** a member who chose "English" on a German device selects "System"
- **THEN** the stored choice SHALL be cleared and the app SHALL reload in German

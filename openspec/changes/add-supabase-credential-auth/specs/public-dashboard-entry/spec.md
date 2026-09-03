## MODIFIED Requirements

### Requirement: Authentication follows an explicit action

The system SHALL require Supabase authentication only when a visitor explicitly chooses to create a WG or join an invitation. It SHALL offer configured Google, email/password, and phone/SMS choices, preserve the validated action intent, and return to the action after authentication. Authentication alone MUST NOT create a WG, create a membership, or reveal private WG data.

#### Scenario: Guest starts WG creation

- **WHEN** a guest selects the create-WG action from the public interface
- **THEN** the system asks for a supported authentication method and returns the guest to the creation form only after authentication

#### Scenario: Guest opens a join link

- **WHEN** a guest opens a valid invitation link and selects join
- **THEN** the system preserves the invitation context through a supported authentication method and asks for the remaining explicit join information after authentication

#### Scenario: Guest browses public modules

- **WHEN** a guest navigates public dashboard or module views without selecting a create or join action
- **THEN** the system does not request authentication and does not load private WG data

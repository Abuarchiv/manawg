## ADDED Requirements

### Requirement: Members choose their language

The profile settings SHALL offer a language choice between "Deutsch" and "English", shown in their own language. The current choice SHALL be selected. The choice SHALL be disabled while offline. Changing it SHALL apply to the whole app after a reload.

#### Scenario: Switch to English in settings
- **WHEN** a member selects "English" in the profile settings
- **THEN** the app SHALL reload in English and the settings SHALL show "English" as selected

#### Scenario: Offline
- **WHEN** the device is offline
- **THEN** the language choice SHALL be disabled with the offline hint

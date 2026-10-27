## ADDED Requirements

### Requirement: Signed-out visitors can start registration or sign-in

The public entry SHALL offer both "Konto erstellen" and "Anmelden" to signed-out visitors, preserving a valid invitation code, without turning public exploration into a login wall.

#### Scenario: Invitation link while signed out

- **WHEN** a signed-out visitor opens `/?code=MTE8PZAT`
- **THEN** the page shows the invitation with a registration action and a sign-in action that both carry the code

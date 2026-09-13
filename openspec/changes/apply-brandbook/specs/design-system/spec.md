## ADDED Requirements

### Requirement: Shared brandbook presentation
The web app SHALL use the supplied ManaWG Brandbook v1.0 through shared tokens, typography, components and assets.

#### Scenario: A member navigates between household modules
- **WHEN** a member opens Start, household, finance or exchange views
- **THEN** the same Neutral theme, Inter family typography, organism identity and accessible controls are used without changing product behavior

### Requirement: Theme and accessibility parity
The app SHALL preserve readable light/dark and reduced-motion states on narrow screens.

#### Scenario: Reduced motion or dark theme is selected
- **WHEN** the corresponding preference applies
- **THEN** the app uses semantic dark tokens or a static loading mark and retains visible focus and navigation

### Requirement: PWA identity
Browser and installed web-app assets SHALL derive from the supplied organism mark.

#### Scenario: The application is installed
- **WHEN** a browser reads the web manifest
- **THEN** it finds valid size-specific monochrome icons, a white background and Neutral 950 theme color

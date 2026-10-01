# private-wg-image-storage Specification

## Purpose
Keep household receipt and announcement images private while making uploads usable with the existing Preview infrastructure. Image access follows the same current-membership boundary as the associated household data.

## Requirements

### Requirement: Immutable bounded private uploads
The system SHALL issue upload authorization only to authenticated active WG members, for a new immutable WG-scoped key. The private storage service MUST enforce an 8 MiB maximum and the supported JPEG, PNG, WebP, HEIC and HEIF MIME types.

#### Scenario: Member uploads an image
- **WHEN** an active member requests and uses an upload authorization for a supported image
- **THEN** the upload succeeds in a private bucket and the stored application URL remains compatible with existing image consumers

#### Scenario: Provider rejects invalid upload
- **WHEN** a direct upload exceeds the storage limit, uses an unsupported MIME type, or attempts to overwrite an existing object
- **THEN** the provider rejects it even if the client bypasses application validation

### Requirement: Membership-gated image reads
The system SHALL authenticate and check active membership for every private image read. It MUST return private, no-store responses and MUST NOT expose an unauthenticated public URL or reusable signed-read URL to the client.

#### Scenario: Authorized image read
- **WHEN** an active member loads the protected URL of an image in their WG
- **THEN** the application serves the image content without exposing storage credentials or signed-read tokens

#### Scenario: Denied or revoked image read
- **WHEN** an unauthenticated, foreign-WG, or deactivated user requests that image
- **THEN** no image bytes or storage redirect are returned, including after a previous successful read

### Requirement: WG-scoped references and keys
The system SHALL reject traversal, malformed keys, unexpected origins, and private image references outside the destination WG on all supported writes.

#### Scenario: Foreign image reference
- **WHEN** a member submits another WG's private image URL to an expense, announcement, or chat write
- **THEN** the write rejects the reference without changing the target record

### Requirement: Explicit provider configuration
The system SHALL retain the existing AWS upload path unless the private Supabase provider is explicitly selected. An unavailable or insecure private bucket MUST cause closed failure, never a public-provider fallback.

#### Scenario: Invalid private bucket
- **WHEN** the configured bucket is missing, public, or lacks the required size or MIME restrictions
- **THEN** the application refuses to sign uploads and reports the feature as unavailable

#### Scenario: Existing clients remain compatible
- **WHEN** online or queued offline uploads use the private provider
- **THEN** the current PUT and stored-image fields continue to work, including receipt links, previews and rendered images

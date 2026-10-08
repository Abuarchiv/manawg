# idempotent-mutations Specification

## Purpose

Make every WG mutation that accepts an `Idempotency-Key` apply at most once and return the same response for the same key, using one shared claim protocol.

## Requirements

### Requirement: A key is applied at most once

The system SHALL perform the write of a mutation request at most once per idempotency scope and key, and SHALL return the stored response for every later request with that scope and key while the response is retained.

#### Scenario: Concurrent requests with the same key
- **WHEN** two requests with the same scope and key run at the same time
- **THEN** exactly one SHALL perform the write and the other SHALL return its response

#### Scenario: Retry after success
- **WHEN** a request with a key whose response is stored arrives again
- **THEN** the system SHALL return the stored response without writing

### Requirement: A failed write frees its key

When a mutation's transaction rolls back after claiming its key, the system SHALL release that claim so that a retry with the same key runs immediately. A release SHALL NOT remove a completed response or a claim held by another request.

#### Scenario: Retry after a rolled-back write
- **WHEN** a write fails after claiming its key and the client retries with the same key
- **THEN** the retry SHALL run the mutation instead of waiting for the claim to expire

### Requirement: One claim protocol

All routes SHALL lock, complete and release claims through the shared helpers in `core/db/claimed-response.ts`, using one placeholder predicate and lease-checked completion.

#### Scenario: Completion after the lease was taken over
- **WHEN** a request's lease expired and another request reclaimed the key
- **THEN** the first request SHALL NOT overwrite the second request's claim or response

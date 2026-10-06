'use client';

import { configureApiClient } from '@/core/infra/api-client';
import { isClientFixtureMode } from './client-mode';

// Runs when the root layout's client modules load, before any component
// effect can issue a request.
if (isClientFixtureMode()) configureApiClient({ memberIdHeader: true });

/** The single client seam of the database-free Playwright build; renders nothing. */
export function FixtureClientSetup(): null {
	return null;
}

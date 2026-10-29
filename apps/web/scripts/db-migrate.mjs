#!/usr/bin/env node
/**
 * Database migrator CLI (`pnpm db:migrate`, `pnpm db:check`; Production runs it only through
 * .github/workflows/migrate-production.yml).
 *
 *   node scripts/db-migrate.mjs           apply pending Drizzle migrations from drizzle/
 *   node scripts/db-migrate.mjs --check   verify schema, catalog security, ledger and data only
 *
 * It accepts only a Supabase session connection (db-migrate/connection.mjs), holds an advisory
 * lock for the whole run, refuses a ledger that is not an exact prefix of the journal, and fails
 * closed on any schema or catalog drift. A database that has the schema but an empty ledger is refused. Failures
 * print one `[migrate] Failed [stage=...] [reason=...]` line and exit 1.
 *
 * The modules live in scripts/db-migrate/; this file is the entry point and re-exports the
 * functions the tests import.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorCodeSuffix, safeFailureReason } from './db-migrate/failure.mjs';
import { main } from './db-migrate/run.mjs';

export { assertCatalogSecurity } from './db-migrate/catalog-security.mjs';
export {
	previewSessionDatabaseUrl,
	productionSessionDatabaseUrl,
	validateDatabaseUrl,
} from './db-migrate/connection.mjs';
export { assertMigrationLedgerPrefix } from './db-migrate/ledger.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const progress = { stage: 'startup' };
	main(progress).catch((err) => {
		console.error(
			`[migrate] Failed [stage=${progress.stage}] [reason=${safeFailureReason(err)}]${errorCodeSuffix(err)}:`,
			err instanceof Error ? err.message : err,
		);
		process.exit(1);
	});
}

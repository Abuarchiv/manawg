import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { validateDatabaseUrl } from './src/core/db/connection';

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const pooledUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const unpooledUrl = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL_UNPOOLED;

let url: string | undefined;
if (migrationUrl) {
	validateDatabaseUrl(migrationUrl, 'DATABASE_MIGRATION_URL');
	url = migrationUrl;
} else if (pooledUrl) {
	validateDatabaseUrl(pooledUrl, 'POSTGRES_URL/DATABASE_URL');
	url = pooledUrl;
} else if (unpooledUrl) {
	validateDatabaseUrl(unpooledUrl, 'POSTGRES_URL_NON_POOLING/DATABASE_URL_UNPOOLED');
	url = unpooledUrl;
} else {
	throw new Error(
		'No database URL configured. Set DATABASE_MIGRATION_URL, POSTGRES_URL, or DATABASE_URL.',
	);
}

export default defineConfig({
	schema: [
		'./src/core/db/schema.ts',
		'./src/core/db/schema-statement-emails.ts',
		'./src/core/db/schema-mail-log.ts',
		'./src/core/db/schema-invites.ts',
		'./src/core/db/schema-inventory.ts',
	],
	out: './drizzle',
	dialect: 'postgresql',
	...(url ? { dbCredentials: { url } } : {}),
	strict: true,
	verbose: true,
});

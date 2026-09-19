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
	const direct = pooledUrl.replace(/-pooler\./, '.');
	validateDatabaseUrl(direct, 'POSTGRES_URL/DATABASE_URL');
	url = direct;
} else if (unpooledUrl) {
	validateDatabaseUrl(unpooledUrl, 'POSTGRES_URL_NON_POOLING/DATABASE_URL_UNPOOLED');
	url = unpooledUrl;
}

// craftsman-ignore: TS002 — drizzle-kit requires default export from drizzle.config.ts
export default defineConfig({
	schema: './src/core/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	...(url ? { dbCredentials: { url } } : {}),
	strict: true,
	verbose: true,
});

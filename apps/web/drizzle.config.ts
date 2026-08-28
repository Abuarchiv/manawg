import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { validateDatabaseUrl } from './src/lib/db/connection';

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const pooledUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const unpooledUrl = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL_UNPOOLED;

let url: string;
if (migrationUrl) {
	validateDatabaseUrl(migrationUrl, 'DATABASE_MIGRATION_URL');
	url = migrationUrl;
} else if (pooledUrl) {
	const direct = pooledUrl.replace(/-pooler\./, '.');
	let parsed: URL;
	try {
		parsed = new URL(direct);
	} catch {
		throw new Error('POSTGRES_URL/DATABASE_URL is not a valid URL.');
	}
	if (parsed.port === '6543') {
		throw new Error(
			'DDL uses a Supabase Transaction Pooler URL on port 6543 without DATABASE_MIGRATION_URL. Set DATABASE_MIGRATION_URL to the direct connection on port 5432.',
		);
	}
	url = direct;
} else if (unpooledUrl) {
	url = unpooledUrl;
} else {
	url = 'postgres://placeholder';
	console.warn(
		'[drizzle.config] POSTGRES_URL is not set — using placeholder. This is fine for `generate`, but `push` and `migrate` require a real connection. Set DATABASE_MIGRATION_URL.',
	);
}

if (url === 'postgres://placeholder') {
	console.warn(
		'[drizzle.config] POSTGRES_URL is not set — using placeholder. This is fine for `generate`, but `push` and `migrate` require a real connection. Run `vercel env pull apps/web/.env.local`.',
	);
}

// craftsman-ignore: TS002 — drizzle-kit requires default export from drizzle.config.ts
export default defineConfig({
	schema: './src/lib/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url },
	strict: true,
	verbose: true,
});

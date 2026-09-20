export function resolveConnectionString(): string {
	const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			'POSTGRES_URL (or DATABASE_URL) is not set. Set a PostgreSQL connection string for the environment.',
		);
	}
	return url;
}

export function resolveTransactionConnectionString(): string {
	const url =
		process.env.POSTGRES_URL_NON_POOLING ||
		process.env.DATABASE_URL_UNPOOLED ||
		resolveConnectionString();
	validateDatabaseUrl(url, 'transaction database connection');
	return url;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

export function validateDatabaseUrl(url: string, label: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`${label} is not a valid URL.`);
	}
	// Drizzle binds BEGIN/COMMIT to one node-postgres client, which supports
	// Supavisor transaction pooling. Migration/session locks use the separate
	// direct-connection validator in scripts/db-migrate.mjs.
	const host = parsed.hostname.toLowerCase();
	const isLocal = LOCAL_HOSTS.has(host) || host.endsWith('.local');
	if (!isLocal && !parsed.port) {
		throw new Error(`${label} must specify a port for remote connections.`);
	}
	if (!isLocal) {
		const sslmode = parsed.searchParams.get('sslmode')?.toLowerCase();
		if (!['require', 'verify-ca', 'verify-full'].includes(sslmode ?? '')) {
			throw new Error(
				`${label} must require TLS for remote connections (sslmode=require, verify-ca, or verify-full).`,
			);
		}
	}
}

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
		process.env.DATABASE_MIGRATION_URL ||
		process.env.POSTGRES_URL_NON_POOLING ||
		process.env.DATABASE_URL_UNPOOLED ||
		resolveConnectionString();
	validateDatabaseUrl(url, 'withTransaction connection (set DATABASE_MIGRATION_URL)');
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
	if (parsed.port === '6543') {
		throw new Error(
			`${label} must not use port 6543 (Supavisor Transaction Pooler). Use port 5432 or omit the port for local/Direct connections.`,
		);
	}
	const host = parsed.hostname.toLowerCase();
	const isLocal = LOCAL_HOSTS.has(host) || host.endsWith('.local');
	if (!isLocal && !parsed.port) {
		throw new Error(`${label} must specify a port for remote connections.`);
	}
}

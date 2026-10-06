/**
 * Connection-string resolution and validation for the migrator. Nothing here opens a connection:
 * every check runs before `pg` is touched, so a misconfigured URL fails without network access.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

export function validateDatabaseUrl(url, label) {
	let parsed;
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
	if ([...parsed.searchParams.keys()].some((key) => key !== 'sslmode')) {
		throw new Error(`${label} must not include unsupported PostgreSQL query parameters.`);
	}
	if (parsed.searchParams.getAll('sslmode').length > 1) {
		throw new Error(`${label} must specify sslmode at most once.`);
	}
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

export function validateSupabaseDirectUrl(url, label) {
	validateDatabaseUrl(url, label);
	const parsed = new URL(url);
	if (
		!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
		!parsed.hostname.toLowerCase().endsWith('.supabase.co') ||
		parsed.port !== '5432'
	) {
		throw new Error(`${label} must be a direct Supabase PostgreSQL connection on port 5432.`);
	}
}

/** Explicit CI transport for the pinned Preview verifier; never a Production fallback. */
export function previewSessionDatabaseUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Preview CI database configuration is invalid.');
	}
	if (
		!['postgres:', 'postgresql:'].includes(url.protocol) ||
		url.hostname !== 'db.sthiwjebcwwiphashgla.supabase.co' ||
		url.port !== '5432' ||
		url.pathname !== '/postgres' ||
		url.username !== 'manawg_preview_ci' ||
		!url.password ||
		url.hash ||
		url.searchParams.size !== 1 ||
		url.searchParams.get('sslmode') !== 'verify-full'
	) {
		throw new Error('Preview CI requires its pinned verifier connection with verified TLS.');
	}
	url.hostname = 'aws-0-eu-central-1.pooler.supabase.com';
	url.username = 'manawg_preview_ci.sthiwjebcwwiphashgla';
	return url.href;
}

/**
 * Turn a Neon pooled host into its direct one. Neon's pooled endpoint is the
 * direct endpoint with a `-pooler` label inserted:
 *   ep-xxx-pooler.region.aws.neon.tech  ->  ep-xxx.region.aws.neon.tech
 * A URL that has no such label (a non-Neon or already-direct host) is returned
 * untouched.
 */
function toDirectEndpoint(url) {
	try {
		const parsed = new URL(url);
		parsed.hostname = parsed.hostname.replace(/-pooler\./, '.');
		return parsed.toString();
	} catch {
		return url;
	}
}

export function resolveConnectionString(env = process.env) {
	const migrationUrl = env.DATABASE_MIGRATION_URL;
	if (migrationUrl) {
		validateDatabaseUrl(migrationUrl, 'DATABASE_MIGRATION_URL');
		return migrationUrl;
	}

	const pooled = env.POSTGRES_URL ?? env.DATABASE_URL;
	if (pooled) {
		const direct = toDirectEndpoint(pooled);
		validateDatabaseUrl(direct, 'POSTGRES_URL/DATABASE_URL');
		return direct;
	}

	const direct = env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL_UNPOOLED;
	if (direct) {
		validateDatabaseUrl(direct, 'POSTGRES_URL_NON_POOLING/DATABASE_URL_UNPOOLED');
		return direct;
	}

	throw new Error('No database URL. Set DATABASE_MIGRATION_URL, POSTGRES_URL or DATABASE_URL.');
}

// Writes a docker env file (libpq variables) for the pinned Production or Preview session pooler
// plus the verified Supabase root certificate into the given directory; the URL comes from
// DATABASE_MIGRATION_URL. Usage: node pg-env.mjs <production|preview> <dir>
import { X509Certificate } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	previewSessionDatabaseUrl,
	productionSessionDatabaseUrl,
} from '../../apps/web/scripts/db-migrate/connection.mjs';
import { SUPABASE_ROOT_CA } from '../../apps/web/src/core/db/supabase-ca.ts';

const [target, dir] = process.argv.slice(2);
const toSession = { production: productionSessionDatabaseUrl, preview: previewSessionDatabaseUrl }[
	target
];
if (!toSession || !dir) throw new Error('Usage: pg-env.mjs <production|preview> <dir>');

const certificate = new X509Certificate(SUPABASE_ROOT_CA);
if (
	certificate.fingerprint256 !==
	'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA'
) {
	throw new Error('Unexpected Supabase root certificate.');
}
writeFileSync(path.join(dir, 'supabase-root.crt'), SUPABASE_ROOT_CA, { mode: 0o644 });

const url = new URL(toSession(process.env.DATABASE_MIGRATION_URL));
const lines = [
	`PGHOST=${url.hostname}`,
	`PGPORT=${url.port}`,
	`PGUSER=${decodeURIComponent(url.username)}`,
	`PGPASSWORD=${decodeURIComponent(url.password)}`,
	`PGDATABASE=${url.pathname.slice(1)}`,
	'PGSSLMODE=verify-full',
	'PGSSLROOTCERT=/work/supabase-root.crt',
];
if (lines.some((line) => /[\r\n]/.test(line)))
	throw new Error('Connection values must be single-line.');
writeFileSync(path.join(dir, 'pg.env'), `${lines.join('\n')}\n`, { mode: 0o600 });

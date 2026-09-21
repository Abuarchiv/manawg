import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
	console.error('[preview-db] Unsupported command.');
	process.exitCode = 1;
} else {
	const phase = args.length === 0 ? 'migration' : 'check';
	const child = spawnSync(
		process.execPath,
		[fileURLToPath(new URL('./db-migrate.mjs', import.meta.url)), ...args],
		{
			env: { ...process.env, MANAWG_PREVIEW_CI_SESSION: 'true' },
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 180_000,
			maxBuffer: 1024 * 1024,
		},
	);
	// Child errors may contain credentials. Emit only a fixed, non-secret failure class.
	if (child.error || child.signal || child.status !== 0) {
		const output = `${child.error?.message ?? ''}\n${child.stderr?.toString() ?? ''}`;
		const failureClass = /Preview CI requires|configuration is invalid|valid URL/i.test(output)
			? 'configuration'
			: /password authentication failed|authentication|28P01/i.test(output)
				? 'authentication'
				: /permission denied|insufficient privilege|42501/i.test(output)
					? 'permission'
					: /certificate|TLS|self[- ]signed|unable to verify|UNABLE_TO_VERIFY/i.test(output)
						? 'tls'
						: /ENETUNREACH|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout/i.test(output)
							? 'network'
							: /Database check failed|migration|schema|constraint|ledger/i.test(output)
								? 'schema'
								: 'database';
		console.error(
			`[preview-db] ${phase} failed (class=${failureClass}, exit=${child.status ?? 'none'}, signal=${child.signal ?? 'none'}).`,
		);
		process.exitCode = 1;
	} else {
		process.stdout.write(`[preview-db] ${phase} verified.\n`);
	}
}

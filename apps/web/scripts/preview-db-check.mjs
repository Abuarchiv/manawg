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
		const sqlState = output.match(/\[code=([A-Z0-9_]{5,})\]/)?.[1] ?? 'unknown';
		const stage = output.match(/\[stage=([a-z-]+)\]/)?.[1] ?? 'unknown';
		const failureClass = /^28/.test(sqlState)
			? 'authentication'
			: sqlState === '42501'
				? 'permission'
				: /^08/.test(sqlState)
					? 'network'
					: /^42/.test(sqlState)
						? 'schema'
						: /Preview CI requires|configuration is invalid|valid URL/i.test(output)
							? 'configuration'
							: /password authentication failed|authentication/i.test(output)
								? 'authentication'
								: /permission denied|insufficient privilege/i.test(output)
									? 'permission'
									: /certificate|TLS|self[- ]signed|unable to verify|UNABLE_TO_VERIFY/i.test(output)
										? 'tls'
										: /ENETUNREACH|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout/i.test(output)
											? 'network'
											: /Database check failed|schema|constraint|ledger|relation|column|syntax/i.test(
														output,
													)
												? 'schema'
												: 'database';
		console.error(
			`[preview-db] ${phase} failed (class=${failureClass}, code=${sqlState}, stage=${stage}, exit=${child.status ?? 'none'}, signal=${child.signal ?? 'none'}).`,
		);
		process.exitCode = 1;
	} else {
		process.stdout.write(`[preview-db] ${phase} verified.\n`);
	}
}

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
	// Child errors may contain credentials. Emit only fixed phase/status diagnostics.
	if (child.error || child.signal || child.status !== 0) {
		console.error(
			`[preview-db] ${phase} failed (exit=${child.status ?? 'none'}, signal=${child.signal ?? 'none'}).`,
		);
		process.exitCode = 1;
	} else {
		process.stdout.write(`[preview-db] ${phase} verified.\n`);
	}
}

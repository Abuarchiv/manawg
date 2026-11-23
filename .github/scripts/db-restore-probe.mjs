#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	appendFileSync,
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESTORE_PROBE_IMAGE =
	'supabase/postgres@sha256:0b64586fb84124b9070525a6528616594a1aa84a75d84cd4c3d43acc8de3ba92';
const POSTGRES_INIT_COMPLETE = 'PostgreSQL init process complete; ready for start up.';

export function validateArchiveEntry(name, type) {
	if (typeof name !== 'string' || !name || /[\0\t\r\n]/.test(name) || name.startsWith('/')) {
		throw new Error('Backup archive contains an unsafe path.');
	}
	const entryType = type ?? (name.endsWith('/') ? 'directory' : 'file');
	if (!['directory', 'file'].includes(entryType)) {
		throw new Error('Backup archive contains a non-regular file.');
	}
	const relative = name.endsWith('/') ? name.slice(0, -1) : name;
	const parts = relative.split('/');
	if (parts.some((part) => part === '' || part === '.' || part === '..')) {
		throw new Error('Backup archive contains an unsafe path.');
	}
	if (parts[0] === 'database.dump' && parts.length === 1 && entryType === 'file') return name;
	if (parts[0] === 'storage' && (parts.length > 1 || entryType === 'directory')) return name;
	throw new Error('Backup archive contains an unexpected path.');
}

export function verifyStorageCoverage(rows, storageRoot) {
	if (!Array.isArray(rows)) throw new Error('Storage metadata is not an array.');
	const root = path.resolve(storageRoot);
	const rootStat = lstatSync(root);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
		throw new Error('Storage archive directory is invalid.');
	}
	const expectedFiles = new Set();
	let byteCount = 0;
	let sizeChecked = 0;

	for (const row of rows) {
		if (!Array.isArray(row) || row.length !== 3) {
			throw new Error('Storage metadata row is invalid.');
		}
		const [bucket, name, rawSize] = row;
		if (
			typeof bucket !== 'string' ||
			bucket.length === 0 ||
			bucket.includes('/') ||
			/[\0\t\r\n]/.test(bucket) ||
			bucket === '.' ||
			bucket === '..' ||
			typeof name !== 'string' ||
			name.length === 0 ||
			name.startsWith('/') ||
			/[\0\t\r\n]/.test(name)
		) {
			throw new Error('Storage metadata contains an unsafe object path.');
		}
		const objectParts = name.split('/');
		if (objectParts.some((part) => part === '' || part === '.' || part === '..')) {
			throw new Error('Storage metadata contains an unsafe object path.');
		}
		const file = path.resolve(root, bucket, ...objectParts);
		if (!file.startsWith(`${root}${path.sep}`)) {
			throw new Error('Storage object path escapes the archive.');
		}
		let fileStat;
		try {
			fileStat = lstatSync(file);
		} catch {
			throw new Error('A Storage object is missing from the archive.');
		}
		if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
			throw new Error('A Storage object is not a regular file.');
		}
		if (rawSize !== null && rawSize !== undefined && rawSize !== '') {
			const expectedSize = Number(rawSize);
			if (
				!Number.isSafeInteger(expectedSize) ||
				expectedSize < 0 ||
				fileStat.size !== expectedSize
			) {
				throw new Error('A Storage object size differs from its restored metadata.');
			}
			sizeChecked += 1;
		}
		const relative = path.relative(root, file);
		if (expectedFiles.has(relative))
			throw new Error('Storage metadata contains a duplicate object.');
		expectedFiles.add(relative);
		byteCount += fileStat.size;
	}

	const actualFiles = new Set();
	function collectFiles(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error('Storage archive contains a symbolic link.');
			if (entry.isDirectory()) collectFiles(entryPath);
			else if (entry.isFile()) actualFiles.add(path.relative(root, entryPath));
			else throw new Error('Storage archive contains an unsupported file type.');
		}
	}
	collectFiles(root);
	if (
		actualFiles.size !== expectedFiles.size ||
		[...actualFiles].some((file) => !expectedFiles.has(file))
	) {
		throw new Error('Storage object rows and archived files do not match.');
	}

	return { objectCount: expectedFiles.size, byteCount, sizeChecked };
}

export function isFinalPostgresReady(logs, probeStatus) {
	return probeStatus === 0 && logs.includes(POSTGRES_INIT_COMPLETE);
}

function run(
	command,
	args,
	stage,
	{ env = process.env, timeout = 120_000, diagnostic = false } = {},
) {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		env,
		maxBuffer: 64 * 1024 * 1024,
		timeout,
	});
	if (result.error || result.status !== 0) {
		const detail = diagnostic
			? ` ${String(result.stderr ?? '')
					.trim()
					.slice(-300)}`
			: '';
		throw new Error(`${stage} failed (exit ${result.status ?? 'spawn'}).${detail}`);
	}
	return result.stdout ?? '';
}

function safeEnvironment(overrides = {}) {
	const env = { ...process.env, ...overrides };
	for (const secret of [
		'BACKUP_GPG_PRIVATE_KEY',
		'BACKUP_GPG_PASSPHRASE',
		'DATABASE_MIGRATION_URL',
		'SUPABASE_BACKUP_SECRET_KEY',
		'PRODUCTION_DEPLOY_HOOK',
	]) {
		delete env[secret];
	}
	return env;
}

function appendSummary(message) {
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
	}
	process.stdout.write(`${message.replace(/\n/g, ' ')}\n`);
}

async function restoreProbe() {
	if (process.env.GITHUB_REF !== 'refs/heads/main') {
		throw new Error('Restore probe is permitted only from main.');
	}
	for (const secret of [
		'DATABASE_MIGRATION_URL',
		'SUPABASE_BACKUP_SECRET_KEY',
		'PRODUCTION_DEPLOY_HOOK',
	]) {
		if (process.env[secret]) {
			throw new Error(
				'Restore probe must not receive Production connection or deployment secrets.',
			);
		}
	}
	let privateKey = process.env.BACKUP_GPG_PRIVATE_KEY;
	let passphrase = process.env.BACKUP_GPG_PASSPHRASE;
	const runnerTemp = process.env.RUNNER_TEMP;
	const artifactDir = process.env.BACKUP_ARTIFACT_DIR;
	const runId = process.env.GITHUB_RUN_ID;
	const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '1';
	if (
		!privateKey ||
		passphrase === undefined ||
		!runnerTemp ||
		!artifactDir ||
		!/^\d+$/.test(runId ?? '') ||
		!/^\d+$/.test(attempt)
	) {
		throw new Error('Restore probe is missing its encrypted artifact or GPG inputs.');
	}
	const runnerRoot = path.resolve(runnerTemp);
	const artifactRoot = path.resolve(artifactDir);
	const artifactRelative = path.relative(runnerRoot, artifactRoot);
	if (
		!artifactRelative ||
		artifactRelative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(artifactRelative)
	) {
		throw new Error('Restore artifact directory is outside Runner.Temp.');
	}
	const artifactRootStat = lstatSync(artifactRoot);
	if (!artifactRootStat.isDirectory() || artifactRootStat.isSymbolicLink()) {
		throw new Error('Restore artifact directory is invalid.');
	}
	const artifacts = readdirSync(artifactRoot).filter((name) => name.endsWith('.tar.gpg'));
	if (artifacts.length !== 1)
		throw new Error('Restore probe requires exactly one encrypted backup artifact.');
	const backupFile = path.join(artifactRoot, artifacts[0]);
	const backupStat = lstatSync(backupFile);
	if (!backupStat.isFile() || backupStat.isSymbolicLink() || backupStat.size === 0) {
		throw new Error('Encrypted backup artifact is missing or invalid.');
	}
	const containerName = `manawg-restore-probe-${runId}-${attempt}`;
	const workDir = mkdtempSync(path.join(runnerRoot, 'manawg-restore-probe-'));
	chmodSync(workDir, 0o700);
	const keyDir = path.join(workDir, 'gpg');
	const gpgHome = path.join(keyDir, 'home');
	const privateKeyFile = path.join(keyDir, 'private.asc');
	const passphraseFile = path.join(keyDir, 'passphrase');
	const postgresEnvFile = path.join(workDir, 'postgres.env');
	const decryptedTar = path.join(workDir, 'backup.tar');
	const extractedDir = path.join(workDir, 'extracted');
	const databaseDump = path.join(extractedDir, 'database.dump');
	const storageDir = path.join(extractedDir, 'storage');
	let containerStarted = false;

	try {
		mkdirSync(keyDir, { mode: 0o700 });
		mkdirSync(gpgHome, { mode: 0o700 });
		writeFileSync(privateKeyFile, privateKey, { mode: 0o600 });
		writeFileSync(passphraseFile, passphrase, { mode: 0o600 });
		privateKey = '';
		passphrase = '';
		delete process.env.BACKUP_GPG_PRIVATE_KEY;
		delete process.env.BACKUP_GPG_PASSPHRASE;
		const gpgEnv = safeEnvironment({ GNUPGHOME: gpgHome });
		run('gpgconf', ['--homedir', gpgHome, '--launch', 'gpg-agent'], 'GPG agent start', {
			env: gpgEnv,
		});
		run(
			'gpg',
			['--batch', '--quiet', '--homedir', gpgHome, '--import', privateKeyFile],
			'GPG key import',
			{ env: gpgEnv, diagnostic: true },
		);
		run(
			'gpg',
			[
				'--batch',
				'--quiet',
				'--homedir',
				gpgHome,
				'--pinentry-mode',
				'loopback',
				'--passphrase-file',
				passphraseFile,
				'--output',
				decryptedTar,
				'--decrypt',
				backupFile,
			],
			'Backup decryption',
			{ env: gpgEnv },
		);

		const names = run('tar', ['-tf', decryptedTar], 'Backup archive listing')
			.trimEnd()
			.split(/\r?\n/);
		const verbose = run('tar', ['-tvf', decryptedTar], 'Backup archive inspection')
			.trimEnd()
			.split(/\r?\n/);
		if (
			names.length === 0 ||
			names.length !== verbose.length ||
			new Set(names).size !== names.length
		) {
			throw new Error('Backup archive entries are incomplete or duplicated.');
		}
		let hasDump = false;
		let hasStorage = false;
		for (let index = 0; index < names.length; index += 1) {
			const type =
				verbose[index]?.[0] === 'd' ? 'directory' : verbose[index]?.[0] === '-' ? 'file' : 'unsafe';
			validateArchiveEntry(names[index], type);
			if (names[index] === 'database.dump' && type === 'file') hasDump = true;
			if ((names[index] === 'storage/' || names[index] === 'storage') && type === 'directory') {
				hasStorage = true;
			}
		}
		if (!hasDump || !hasStorage)
			throw new Error('Backup archive lacks the database dump or Storage tree.');
		mkdirSync(extractedDir, { mode: 0o700 });
		run('tar', ['-xf', decryptedTar, '-C', extractedDir], 'Backup extraction');
		const dumpStat = lstatSync(databaseDump);
		const storageStat = lstatSync(storageDir);
		if (
			!dumpStat.isFile() ||
			dumpStat.isSymbolicLink() ||
			!storageStat.isDirectory() ||
			storageStat.isSymbolicLink()
		) {
			throw new Error('Restored archive layout is invalid.');
		}

		const containerExists = spawnSync('docker', ['container', 'inspect', containerName], {
			stdio: 'ignore',
		});
		if (containerExists.status === 0)
			throw new Error('Temporary restore container name already exists.');
		const localPassword = randomBytes(32).toString('hex');
		writeFileSync(
			postgresEnvFile,
			[
				`POSTGRES_PASSWORD=${localPassword}`,
				'POSTGRES_USER=supabase_admin',
				'POSTGRES_DB=postgres',
				'POSTGRES_HOST=/var/run/postgresql',
				'POSTGRES_PORT=5432',
				'PGPORT=5432',
				'PGDATABASE=postgres',
				'',
			].join('\n'),
			{ mode: 0o600 },
		);
		run(
			'docker',
			[
				'run',
				'--detach',
				'--rm',
				'--name',
				containerName,
				'--network',
				'none',
				'--tmpfs',
				'/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=2g',
				'--tmpfs',
				'/tmp:rw,noexec,nosuid,nodev,size=512m',
				'--env-file',
				postgresEnvFile,
				RESTORE_PROBE_IMAGE,
				'postgres',
				'-c',
				'config_file=/etc/postgresql/postgresql.conf',
				'-c',
				'log_min_messages=fatal',
			],
			'Disposable Postgres start',
			{ timeout: 8 * 60 * 1000 },
		);
		containerStarted = true;
		let ready = false;
		let logs = '';
		for (let retry = 0; retry < 60; retry += 1) {
			if (!logs.includes(POSTGRES_INIT_COMPLETE)) {
				const logResult = spawnSync('docker', ['logs', containerName], {
					encoding: 'utf8',
					maxBuffer: 64 * 1024 * 1024,
				});
				logs =
					logResult.status === 0
						? `${logResult.stdout ?? ''}\n${logResult.stderr ?? ''}`
						: '';
			}
			const probe = spawnSync(
				'docker',
				[
					'exec',
					containerName,
					'pg_isready',
					'-U',
					'supabase_admin',
					'-h',
					'/var/run/postgresql',
				],
				{ stdio: 'ignore' },
			);
			if (isFinalPostgresReady(logs, probe.status)) {
				ready = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		if (!ready) throw new Error('Disposable Postgres did not become ready.');
		run(
			'docker',
			[
				'exec',
				containerName,
				'createdb',
				'-U',
				'supabase_admin',
				'-T',
				'template0',
				'manawg_restore_probe',
			],
			'Empty restore database creation',
		);
		run(
			'docker',
			[
				'exec',
				containerName,
				'psql',
				'-X',
				'-q',
				'-v',
				'ON_ERROR_STOP=1',
				'-U',
				'supabase_admin',
				'-d',
				'manawg_restore_probe',
				'-c',
				'CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage; CREATE SCHEMA IF NOT EXISTS drizzle; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
			],
			'Extension setup in restore database',
			{ diagnostic: true },
		);
		// docker cp can bypass mounted /tmp, so keep the dump in the disposable container layer.
		const containerDump = '/var/lib/postgresql/database.dump';
		run('docker', ['cp', databaseDump, `${containerName}:${containerDump}`], 'Database dump copy');
		const toc = run(
			'docker',
			['exec', containerName, 'pg_restore', '--list', containerDump],
			'Database dump validation',
		);
		for (const required of [
			'TABLE DATA public wgs',
			'TABLE DATA public wg_members',
			'TABLE DATA auth users',
			'TABLE DATA storage objects',
			'TABLE DATA drizzle __drizzle_migrations',
		]) {
			if (!toc.includes(required)) throw new Error('Backup is missing a required restored table.');
		}
		if (toc.split(/\r?\n/).some((line) => /\bTABLE(?: DATA)? vault\b/.test(line))) {
			throw new Error('Backup includes Supabase Vault data outside the reviewed restore scope.');
		}
		run(
			'docker',
			[
				'exec',
				containerName,
				'pg_restore',
				'--username=supabase_admin',
				'--clean',
				'--if-exists',
				'--no-owner',
				'--no-privileges',
				'--exit-on-error',
				'--single-transaction',
				'--schema=public',
				'--schema=drizzle',
				'--schema=auth',
				'--schema=storage',
				'--dbname=manawg_restore_probe',
				containerDump,
			],
			'Database restore',
			{ timeout: 10 * 60 * 1000 },
		);
		const counts = JSON.parse(
			run(
				'docker',
				[
					'exec',
					containerName,
					'psql',
					'-X',
					'-qAt',
					'-v',
					'ON_ERROR_STOP=1',
					'-U',
					'supabase_admin',
					'-d',
					'manawg_restore_probe',
					'-c',
					"SELECT json_build_object('wgs',(SELECT count(*) FROM public.wgs),'members',(SELECT count(*) FROM public.wg_members),'auth_users',(SELECT count(*) FROM auth.users),'storage_objects',(SELECT count(*) FROM storage.objects),'migrations',(SELECT count(*) FROM drizzle.__drizzle_migrations))::text",
				],
				'Restored table checks',
			).trim(),
		);
		const storageRows = JSON.parse(
			run(
				'docker',
				[
					'exec',
					containerName,
					'psql',
					'-X',
					'-qAt',
					'-v',
					'ON_ERROR_STOP=1',
					'-U',
					'supabase_admin',
					'-d',
					'manawg_restore_probe',
					'-c',
					"SELECT COALESCE(json_agg(json_build_array(bucket_id,name,metadata->>'size') ORDER BY bucket_id,name),'[]'::json)::text FROM storage.objects",
				],
				'Restored Storage metadata checks',
			).trim(),
		);
		const coverage = verifyStorageCoverage(storageRows, storageDir);
		if (coverage.objectCount !== Number(counts.storage_objects)) {
			throw new Error('Restored Storage row and file counts do not match.');
		}
		appendSummary(
			[
				'### Isolated backup restore probe',
				'',
				'- Restored this run’s encrypted backup into a disposable Supabase Postgres database with no network or published ports.',
				`- Restored rows: WGs ${counts.wgs}, members ${counts.members}, Auth users ${counts.auth_users}, Storage metadata ${counts.storage_objects}, migration ledger ${counts.migrations}.`,
				`- Storage coverage: ${coverage.objectCount} archived objects and ${coverage.byteCount} bytes matched; metadata sizes checked for ${coverage.sizeChecked} objects.`,
				'- The probe covers public, drizzle, auth, storage metadata, and archived Storage files. Supabase Vault secrets are not included or read.',
				'- The target uses a tmpfs database, no external network, no Production connection, and is removed at job end.',
			].join('\n'),
		);
	} finally {
		if (containerStarted)
			spawnSync('docker', ['stop', containerName], { stdio: 'ignore', timeout: 30_000 });
		spawnSync('gpgconf', ['--homedir', gpgHome, '--kill', 'gpg-agent'], {
			stdio: 'ignore',
			timeout: 5_000,
		});
		const runnerRoot = path.resolve(runnerTemp);
		if (workDir.startsWith(`${runnerRoot}${path.sep}`))
			rmSync(workDir, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	restoreProbe().catch((error) => {
		console.error(
			`Restore probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
		);
		process.exitCode = 1;
	});
}

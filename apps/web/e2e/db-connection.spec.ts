import { expect, test } from '@playwright/test';
import {
	resolveConnectionString,
	resolveTransactionConnectionString,
} from '../src/core/db/connection';

const keys = [
	'DATABASE_MIGRATION_URL',
	'POSTGRES_URL_NON_POOLING',
	'DATABASE_URL_UNPOOLED',
	'POSTGRES_URL',
	'DATABASE_URL',
] as const;

for (const migrationUrl of [
	'placeholder',
	'postgresql://migrator:example@other.example.test:5432/app?sslmode=verify-full',
]) {
	test(`application transactions ignore migration-only URL: ${migrationUrl === 'placeholder' ? 'invalid' : 'different database'}`, () => {
		const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
		try {
			for (const key of keys) delete process.env[key];
			const runtimeUrl = 'postgresql://app:example@db.example.test:5432/app?sslmode=verify-full';
			process.env.POSTGRES_URL = runtimeUrl;
			process.env.DATABASE_MIGRATION_URL = migrationUrl;
			expect(resolveTransactionConnectionString()).toBe(runtimeUrl);
		} finally {
			for (const key of keys) {
				if (previous[key] === undefined) delete process.env[key];
				else process.env[key] = previous[key];
			}
		}
	});
}

test('transaction runtime aliases retain priority and validation', () => {
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	try {
		for (const key of keys) delete process.env[key];
		expect(() => resolveTransactionConnectionString()).toThrow(
			'POSTGRES_URL (or DATABASE_URL) is not set',
		);
		process.env.DATABASE_URL =
			'postgresql://app:example@db.example.test:5432/fallback?sslmode=verify-full';
		expect(resolveTransactionConnectionString()).toBe(process.env.DATABASE_URL);
		process.env.POSTGRES_URL =
			'postgresql://app:example@db.example.test:5432/runtime?sslmode=verify-full';
		expect(resolveTransactionConnectionString()).toBe(process.env.POSTGRES_URL);
		process.env.DATABASE_URL_UNPOOLED =
			'postgresql://app:example@db.example.test:5432/unpooled?sslmode=verify-full';
		expect(resolveTransactionConnectionString()).toBe(process.env.DATABASE_URL_UNPOOLED);
		process.env.POSTGRES_URL_NON_POOLING =
			'postgresql://app:example@db.example.test:5432/direct?sslmode=verify-full';
		expect(resolveTransactionConnectionString()).toBe(process.env.POSTGRES_URL_NON_POOLING);
		process.env.POSTGRES_URL_NON_POOLING = 'placeholder';
		expect(() => resolveTransactionConnectionString()).toThrow('not a valid URL');
		process.env.POSTGRES_URL_NON_POOLING =
			'postgresql://app:example@db.example.test:6543/app?sslmode=verify-full';
		expect(resolveTransactionConnectionString()).toBe(process.env.POSTGRES_URL_NON_POOLING);
		process.env.POSTGRES_URL_NON_POOLING = 'postgresql://app:example@db.example.test:5432/app';
		expect(new URL(resolveTransactionConnectionString()).searchParams.get('sslmode')).toBe(
			'verify-full',
		);
	} finally {
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
	}
});

test('remote runtime connections enforce certificate-verified TLS', () => {
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	try {
		for (const key of keys) delete process.env[key];
		for (const mode of ['', 'disable', 'no-verify', 'require', 'verify-ca', 'verify-full']) {
			const url = new URL('postgresql://app:example@db.example.test:6543/app');
			if (mode) url.searchParams.set('sslmode', mode);
			url.searchParams.set('application_name', 'release-check');
			url.searchParams.set('ssl', 'false');
			url.searchParams.set('uselibpqcompat', 'true');
			url.searchParams.set('sslrootcert', '/private/certs/database-ca.pem');
			process.env.POSTGRES_URL = url.href;
			for (const resolve of [resolveConnectionString, resolveTransactionConnectionString]) {
				const result = new URL(resolve());
				expect(result.searchParams.get('sslmode')).toBe('verify-full');
				expect(result.searchParams.get('application_name')).toBe('release-check');
				expect(result.searchParams.get('sslrootcert')).toBe('/private/certs/database-ca.pem');
				expect(result.hostname).toBe(url.hostname);
			}
		}
		process.env.POSTGRES_URL = 'postgresql://app:example@localhost/app';
		expect(resolveConnectionString()).toBe(process.env.POSTGRES_URL);
		expect(resolveTransactionConnectionString()).toBe(process.env.POSTGRES_URL);
		process.env.POSTGRES_URL = 'postgresql://app:example@[::1]/app';
		expect(resolveConnectionString()).toBe(process.env.POSTGRES_URL);
		expect(resolveTransactionConnectionString()).toBe(process.env.POSTGRES_URL);
		process.env.POSTGRES_URL = 'https://db.example.test:5432/app';
		expect(() => resolveConnectionString()).toThrow('must be a PostgreSQL URL');
		expect(() => resolveTransactionConnectionString()).toThrow('must be a PostgreSQL URL');
		process.env.POSTGRES_URL =
			'postgresql://app:example@localhost:5432/app?host=remote.example.test&sslmode=disable';
		expect(() => resolveConnectionString()).toThrow('must not override its host');
		expect(() => resolveTransactionConnectionString()).toThrow('must not override its host');
	} finally {
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
	}
});

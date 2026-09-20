import { expect, test } from '@playwright/test';
import { resolveTransactionConnectionString } from '../src/core/db/connection';

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
		expect(() => resolveTransactionConnectionString()).toThrow('must not use port 6543');
		process.env.POSTGRES_URL_NON_POOLING = 'postgresql://app:example@db.example.test:5432/app';
		expect(() => resolveTransactionConnectionString()).toThrow('must require TLS');
	} finally {
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
	}
});

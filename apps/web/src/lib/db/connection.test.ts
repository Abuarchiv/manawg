import { afterEach, describe, expect, it } from 'vitest';

import { unsetEnvVar } from '@/test/env';
import { resolveConnectionString, validateDatabaseUrl } from './connection';

const ORIGINAL_POSTGRES_URL = process.env.POSTGRES_URL;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

const restoreEnv = () => {
	if (ORIGINAL_POSTGRES_URL === undefined) unsetEnvVar('POSTGRES_URL');
	else process.env.POSTGRES_URL = ORIGINAL_POSTGRES_URL;
	if (ORIGINAL_DATABASE_URL === undefined) unsetEnvVar('DATABASE_URL');
	else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
};

describe('resolveConnectionString', () => {
	afterEach(restoreEnv);

	it('prefers POSTGRES_URL over DATABASE_URL', () => {
		process.env.POSTGRES_URL = 'postgres://primary/db';
		process.env.DATABASE_URL = 'postgres://fallback/db';

		expect(resolveConnectionString()).toBe('postgres://primary/db');
	});

	it('falls back to DATABASE_URL', () => {
		unsetEnvVar('POSTGRES_URL');
		process.env.DATABASE_URL = 'postgres://fallback/db';

		expect(resolveConnectionString()).toBe('postgres://fallback/db');
	});

	it('throws an actionable error when neither is set', () => {
		unsetEnvVar('POSTGRES_URL');
		unsetEnvVar('DATABASE_URL');

		expect(() => resolveConnectionString()).toThrow(/POSTGRES_URL/);
		expect(() => resolveConnectionString()).toThrow(/PostgreSQL connection string/);
	});

	it('treats an empty string as unset, because that is how CI clears it', () => {
		process.env.POSTGRES_URL = '';
		process.env.DATABASE_URL = '';

		expect(() => resolveConnectionString()).toThrow(/POSTGRES_URL/);
	});
});

describe('validateDatabaseUrl', () => {
	it('accepts a local URL without port', () => {
		expect(() =>
			validateDatabaseUrl('postgres://localhost/db', 'DATABASE_MIGRATION_URL'),
		).not.toThrow();
	});

	it('accepts a local URL with port 5432', () => {
		expect(() =>
			validateDatabaseUrl('postgres://localhost:5432/db', 'DATABASE_MIGRATION_URL'),
		).not.toThrow();
	});

	it('accepts a remote URL with an explicit port', () => {
		expect(() =>
			validateDatabaseUrl(
				'postgres://ep-xxx.region.aws.neon.tech:5432/db',
				'DATABASE_MIGRATION_URL',
			),
		).not.toThrow();
	});

	it('rejects port 6543 even for DATABASE_MIGRATION_URL', () => {
		expect(() =>
			validateDatabaseUrl(
				'postgres://ep-xxx-pooler.region.aws.neon.tech:6543/db',
				'DATABASE_MIGRATION_URL',
			),
		).toThrow(/must not use port 6543/);
	});

	it('rejects an invalid URL', () => {
		expect(() => validateDatabaseUrl('not-a-url', 'DATABASE_MIGRATION_URL')).toThrow(
			/not a valid URL/,
		);
	});

	it('rejects a remote URL without port', () => {
		expect(() =>
			validateDatabaseUrl('postgres://ep-xxx.region.aws.neon.tech/db', 'DATABASE_MIGRATION_URL'),
		).toThrow(/must specify a port/);
	});

	it('uses the label in error messages', () => {
		expect(() => validateDatabaseUrl('not-a-url', 'TEST_LABEL')).toThrow(/TEST_LABEL/);
	});
});

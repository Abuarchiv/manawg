import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';
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

test('Supabase connections use the official CA without disabling verification', () => {
	const previous = process.env.POSTGRES_URL;
	try {
		process.env.POSTGRES_URL =
			'postgresql://example:example@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
		const result = resolveConnectionString();
		const certPath = new URL(result).searchParams.get('sslrootcert');
		expect(certPath).toBeTruthy();
		if (!certPath) throw new Error('Missing Supabase root CA');
		const cert = new X509Certificate(readFileSync(certPath));
		expect(cert.fingerprint256).toBe(
			'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
		);
		const ssl = Reflect.get(new Client({ connectionString: result }), 'connectionParameters').ssl;
		expect(ssl).not.toBe(false);
		expect(ssl.rejectUnauthorized).not.toBe(false);
		expect(ssl.ca).toBeTruthy();
		expect(new URL(resolveConnectionString()).searchParams.get('sslrootcert')).toBe(certPath);
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, 'POSTGRES_URL');
		else process.env.POSTGRES_URL = previous;
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

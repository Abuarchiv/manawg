import { describe, expect, it } from 'vitest';
import { checkEnv } from './env';

const PRODUCTION_ENV = {
	VERCEL_ENV: 'production',
	POSTGRES_URL: 'postgres://user:pw@db.example.com/manawg',
	UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
	UPSTASH_REDIS_REST_TOKEN: 'token',
	NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub',
	VAPID_PRIVATE_KEY: 'priv',
	VAPID_SUBJECT: 'mailto:ops@example.com',
	CRON_SECRET: 'secret',
	MEMBER_SESSION_SECRET: 'member-secret',
	AWS_ACCESS_KEY_ID: 'key',
	AWS_SECRET_ACCESS_KEY: 'secret',
	AWS_REGION: 'eu-central-1',
	S3_BUCKET: 'manawg-uploads',
};

describe('checkEnv', () => {
	it('reports no problems when production has every variable set', () => {
		const result = checkEnv(PRODUCTION_ENV);

		expect(result.missingRequired).toEqual([]);
		expect(result.degraded).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('flags a missing database URL as required in production', () => {
		const { POSTGRES_URL, ...withoutDb } = PRODUCTION_ENV;

		const result = checkEnv(withoutDb);

		expect(result.missingRequired).toContain('POSTGRES_URL');
		expect(result.ok).toBe(false);
	});

	it('accepts DATABASE_URL as an alternative to POSTGRES_URL', () => {
		const { POSTGRES_URL, ...withoutDb } = PRODUCTION_ENV;

		const result = checkEnv({ ...withoutDb, DATABASE_URL: POSTGRES_URL });

		expect(result.missingRequired).toEqual([]);
	});

	it('reports missing rate limiting as a degraded feature, not a hard failure', () => {
		const { UPSTASH_REDIS_REST_URL, ...withoutRedis } = PRODUCTION_ENV;

		const result = checkEnv(withoutRedis);

		expect(result.missingRequired).toEqual([]);
		expect(result.degraded).toContainEqual(expect.objectContaining({ feature: 'rate-limiting' }));
		expect(result.ok).toBe(true);
	});

	it('reports push notifications as degraded when a VAPID key is missing', () => {
		const { VAPID_PRIVATE_KEY, ...withoutVapid } = PRODUCTION_ENV;

		const result = checkEnv(withoutVapid);

		expect(result.degraded).toContainEqual(
			expect.objectContaining({ feature: 'push-notifications' }),
		);
	});

	it('reports image uploads as degraded when AWS credentials are incomplete', () => {
		const { AWS_SECRET_ACCESS_KEY, ...withoutAws } = PRODUCTION_ENV;

		const result = checkEnv(withoutAws);

		expect(result.degraded).toContainEqual(expect.objectContaining({ feature: 'image-uploads' }));
	});

	it('treats CRON_SECRET as required in production so cron routes stay protected', () => {
		const { CRON_SECRET, ...withoutSecret } = PRODUCTION_ENV;

		const result = checkEnv(withoutSecret);

		expect(result.missingRequired).toContain('CRON_SECRET');
	});

	it('treats MEMBER_SESSION_SECRET as required in production so admin WG mutations stay signed', () => {
		const { MEMBER_SESSION_SECRET, ...withoutSecret } = PRODUCTION_ENV;

		const result = checkEnv(withoutSecret);

		expect(result.missingRequired).toContain('MEMBER_SESSION_SECRET');
		expect(result.ok).toBe(false);
	});

	it('requires nothing but the database and the member-session secret outside production', () => {
		const result = checkEnv({
			POSTGRES_URL: 'postgres://localhost/manawg',
			MEMBER_SESSION_SECRET: 'member-secret',
		});

		expect(result.missingRequired).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('flags a missing member-session secret as required outside production too', () => {
		const result = checkEnv({ POSTGRES_URL: 'postgres://localhost/manawg' });

		expect(result.missingRequired).toContain('MEMBER_SESSION_SECRET');
		expect(result.ok).toBe(false);
	});

	it('allows the exact database-down fixture mode outside production', () => {
		const result = checkEnv({
			CI: 'true',
			NEXT_PUBLIC_DB_DOWN: 'true',
			POSTGRES_URL: '',
			DATABASE_URL: '',
		});

		expect(result.missingRequired).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('keeps production strict even when the database-down fixture flags are set', () => {
		const result = checkEnv({
			VERCEL_ENV: 'production',
			CI: 'true',
			NEXT_PUBLIC_DB_DOWN: 'true',
			POSTGRES_URL: '',
			DATABASE_URL: '',
			CRON_SECRET: 'secret',
			MEMBER_SESSION_SECRET: 'member-secret',
		});

		expect(result.missingRequired).toEqual(['POSTGRES_URL']);
		expect(result.ok).toBe(false);
	});

	it('lists every degraded feature outside production without failing', () => {
		const result = checkEnv({ POSTGRES_URL: 'postgres://localhost/manawg' });

		const features = result.degraded.map((entry) => entry.feature);
		expect(features).toContain('rate-limiting');
		expect(features).toContain('push-notifications');
		expect(features).toContain('image-uploads');
	});

	it('names the missing variables for each degraded feature', () => {
		const { AWS_REGION, ...withoutRegion } = PRODUCTION_ENV;

		const result = checkEnv(withoutRegion);

		const uploads = result.degraded.find((entry) => entry.feature === 'image-uploads');
		expect(uploads?.missing).toEqual(['AWS_REGION']);
	});

	it('reports image uploads as degraded when S3_BUCKET is missing', () => {
		const { S3_BUCKET, ...withoutBucket } = PRODUCTION_ENV;

		const result = checkEnv(withoutBucket);

		const uploads = result.degraded.find((entry) => entry.feature === 'image-uploads');
		expect(uploads?.missing).toEqual(['S3_BUCKET']);
	});

	it('treats blank strings as unset', () => {
		const result = checkEnv({ ...PRODUCTION_ENV, CRON_SECRET: '   ' });

		expect(result.missingRequired).toContain('CRON_SECRET');
	});
});

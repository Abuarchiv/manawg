import { expect, test } from '@playwright/test';
import { checkEnv } from '../src/core/infra/env';
import {
	getPrivateImageUrl,
	imageUrlSchema,
	isAllowedImageUrlForWg,
	parsePrivateImageKey,
} from '../src/core/validators/image-url';

const WG_A = '11111111-1111-4111-8111-111111111111';
const WG_B = '22222222-2222-4222-8222-222222222222';
const IMAGE_ID = '33333333-3333-4333-8333-333333333333';
const PRIVATE_KEY = `manawg/${WG_A}/expense/${IMAGE_ID}.webp`;

const ENV_KEYS = [
	'VERCEL_URL',
	'VERCEL_ENV',
	'NEXT_PUBLIC_APP_URL',
	'S3_PUBLIC_URL',
	'S3_BUCKET',
	'AWS_REGION',
	'IMAGE_STORAGE_PROVIDER',
	'SUPABASE_SERVICE_ROLE_KEY',
	'SUPABASE_STORAGE_BUCKET',
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function baseEnv(): Record<string, string> {
	return {
		POSTGRES_URL: 'postgres://user:pass@host/db',
		MEMBER_SESSION_SECRET: 'session-secret',
		NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
		NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
		VERCEL_ENV: 'preview',
		AWS_ACCESS_KEY_ID: 'aws-key',
		AWS_SECRET_ACCESS_KEY: 'aws-secret',
		AWS_REGION: 'eu-central-1',
		S3_BUCKET: 'legacy-bucket',
	};
}

test.describe('private image URL contract', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(() => {
		setEnv({
			VERCEL_URL: 'preview.manawg.example',
			VERCEL_ENV: 'preview',
			NEXT_PUBLIC_APP_URL: 'https://manawg.com',
			S3_PUBLIC_URL: 'https://legacy-bucket.s3.eu-central-1.amazonaws.com',
			S3_BUCKET: 'legacy-bucket',
			AWS_REGION: 'eu-central-1',
			IMAGE_STORAGE_PROVIDER: undefined,
		});
	});

	test.afterAll(() => {
		for (const [key, value] of originalEnv) setEnv({ [key]: value });
	});

	test('parses only the exact WG-scoped private key grammar', () => {
		expect(parsePrivateImageKey(PRIVATE_KEY)).toEqual({ wgId: WG_A });
		expect(parsePrivateImageKey(`manawg/${WG_A}/announcement/${IMAGE_ID}.heif`)).toEqual({
			wgId: WG_A,
		});
		expect(parsePrivateImageKey(`manawg/${WG_A}/expense/${IMAGE_ID}.jpg/extra`)).toBeNull();
		expect(parsePrivateImageKey(`manawg/${WG_A}/expense/../${IMAGE_ID}.jpg`)).toBeNull();
		expect(parsePrivateImageKey(`manawg/${WG_A}/other/${IMAGE_ID}.jpg`)).toBeNull();
		expect(parsePrivateImageKey(`manawg/${WG_A}/expense/${IMAGE_ID}.gif`)).toBeNull();
	});

	test('uses the trusted Preview origin and enforces the destination WG', () => {
		const url = getPrivateImageUrl(PRIVATE_KEY);

		expect(url).toBe(
			`https://preview.manawg.example/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
		);
		expect(imageUrlSchema.safeParse(url).success).toBe(true);
		expect(isAllowedImageUrlForWg(url, WG_A)).toBe(true);
		expect(isAllowedImageUrlForWg(url, WG_B)).toBe(false);
		expect(
			imageUrlSchema.safeParse(`https://preview.manawg.example/api/upload/read?key=${PRIVATE_KEY}`)
				.success,
		).toBe(true);
	});

	test('uses the stable configured origin outside Preview', () => {
		setEnv({ VERCEL_ENV: 'production', VERCEL_URL: 'preview.manawg.example' });

		expect(getPrivateImageUrl(PRIVATE_KEY)).toBe(
			`https://manawg.com/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
		);
	});

	test('rejects private read URLs with credentials', () => {
		const url = `https://user:pass@preview.manawg.example/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`;

		expect(imageUrlSchema.safeParse(url).success).toBe(false);
		expect(isAllowedImageUrlForWg(url, WG_A)).toBe(false);
	});

	test('rejects public HTTP in production but permits explicit local development hosts', () => {
		setEnv({
			VERCEL_ENV: 'production',
			VERCEL_URL: 'preview.manawg.example',
			NEXT_PUBLIC_APP_URL: 'http://manawg.com',
		});

		expect(() => getPrivateImageUrl(PRIVATE_KEY)).toThrow();
		expect(
			imageUrlSchema.safeParse(
				`http://manawg.com/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
			).success,
		).toBe(false);

		for (const host of ['localhost', '127.0.0.1', '[::1]']) {
			setEnv({
				VERCEL_ENV: 'development',
				VERCEL_URL: undefined,
				NEXT_PUBLIC_APP_URL: `http://${host}:3000`,
			});
			const localUrl = getPrivateImageUrl(PRIVATE_KEY);

			expect(localUrl).toBe(
				`http://${host}:3000/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
			);
			expect(imageUrlSchema.safeParse(localUrl).success).toBe(true);
		}
	});

	test('rejects foreign origins, traversal, fragments, and extra query parameters', () => {
		const encodedKey = encodeURIComponent(PRIVATE_KEY);
		const invalidUrls = [
			`https://evil.example/api/upload/read?key=${encodedKey}`,
			`https://preview.manawg.example/api/upload/read/extra?key=${encodedKey}`,
			`https://preview.manawg.example/api/upload/../upload/read?key=${encodedKey}`,
			`https://preview.manawg.example/api/upload/read?key=${encodedKey}#fragment`,
			`https://preview.manawg.example/api/upload/read?key=${encodedKey}&extra=1`,
			`https://preview.manawg.example/api/upload/read?key=${encodedKey}&key=${encodedKey}`,
		];

		for (const url of invalidUrls) {
			expect(imageUrlSchema.safeParse(url).success).toBe(false);
			expect(isAllowedImageUrlForWg(url, WG_A)).toBe(false);
		}
	});

	test('preserves the legacy AWS allowlist behavior', () => {
		expect(
			imageUrlSchema.safeParse(
				'https://legacy-bucket.s3.eu-central-1.amazonaws.com/anything.jpg?cache=1',
			).success,
		).toBe(true);
		expect(
			imageUrlSchema.safeParse('https://legacy-bucket.s3.amazonaws.com/anything.jpg').success,
		).toBe(true);
		expect(
			imageUrlSchema.safeParse('https://other-bucket.s3.eu-central-1.amazonaws.com/x.jpg').success,
		).toBe(false);
	});

	test('reports explicit provider requirements without changing the AWS default', () => {
		const aws = checkEnv(baseEnv());
		expect(aws.degraded.some((entry) => entry.feature === 'image-uploads')).toBe(false);

		const supabase = checkEnv({
			...baseEnv(),
			IMAGE_STORAGE_PROVIDER: 'supabase',
			SUPABASE_SERVICE_ROLE_KEY: 'server-key',
			SUPABASE_STORAGE_BUCKET: 'private-images',
		});
		expect(supabase.degraded.some((entry) => entry.feature === 'image-uploads')).toBe(false);

		const maskedValues = checkEnv({
			...baseEnv(),
			IMAGE_STORAGE_PROVIDER: 'supabase',
			SUPABASE_SERVICE_ROLE_KEY: '********',
			SUPABASE_STORAGE_BUCKET: 'private-images',
		});
		expect(maskedValues.degraded.some((entry) => entry.feature === 'image-uploads')).toBe(false);

		const unknown = checkEnv({ ...baseEnv(), IMAGE_STORAGE_PROVIDER: 'unknown' });
		const unknownImage = unknown.degraded.find((entry) => entry.feature === 'image-uploads');
		expect(unknownImage?.missing).toContain('IMAGE_STORAGE_PROVIDER');

		const invalidSupabase = checkEnv({
			...baseEnv(),
			IMAGE_STORAGE_PROVIDER: 'supabase',
			NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
			SUPABASE_STORAGE_BUCKET: '',
			SUPABASE_SERVICE_ROLE_KEY: '',
		});
		const invalidImage = invalidSupabase.degraded.find(
			(entry) => entry.feature === 'image-uploads',
		);
		expect(invalidImage?.missing).toEqual(
			expect.arrayContaining([
				'NEXT_PUBLIC_SUPABASE_URL',
				'SUPABASE_STORAGE_BUCKET',
				'SUPABASE_SERVICE_ROLE_KEY',
			]),
		);
	});
});

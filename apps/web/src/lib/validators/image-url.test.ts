import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageUrlSchema, isAllowedImageHost } from './image-url';

describe('isAllowedImageHost', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('rejects javascript: scheme', () => {
		expect(isAllowedImageHost('javascript:alert(1)')).toBe(false);
	});

	it('rejects data: URIs', () => {
		expect(isAllowedImageHost('data:text/html,<script>alert(1)</script>')).toBe(false);
	});

	it('rejects http:// (must be https)', () => {
		vi.stubEnv('S3_PUBLIC_URL', 'https://manawg.s3.eu-central-1.amazonaws.com');
		expect(isAllowedImageHost('http://manawg.s3.eu-central-1.amazonaws.com/x.jpg')).toBe(false);
	});

	it('rejects arbitrary https hosts when allowlist is configured', () => {
		vi.stubEnv('S3_PUBLIC_URL', 'https://manawg.s3.eu-central-1.amazonaws.com');
		expect(isAllowedImageHost('https://evil.example.com/x.jpg')).toBe(false);
	});

	it('accepts the configured S3 public URL host', () => {
		vi.stubEnv('S3_PUBLIC_URL', 'https://manawg.s3.eu-central-1.amazonaws.com');
		expect(isAllowedImageHost('https://manawg.s3.eu-central-1.amazonaws.com/path/x.jpg')).toBe(
			true,
		);
	});

	it('accepts derived bucket+region host', () => {
		vi.stubEnv('S3_PUBLIC_URL', '');
		vi.stubEnv('S3_BUCKET', 'manawg');
		vi.stubEnv('AWS_REGION', 'eu-central-1');
		expect(isAllowedImageHost('https://manawg.s3.eu-central-1.amazonaws.com/x.jpg')).toBe(true);
	});

	it('rejects image hosts when allowlist is empty', () => {
		vi.stubEnv('S3_PUBLIC_URL', '');
		vi.stubEnv('S3_BUCKET', '');
		vi.stubEnv('AWS_REGION', '');
		expect(isAllowedImageHost('https://bucket.s3.amazonaws.com/x.jpg')).toBe(false);
		expect(isAllowedImageHost('https://evil.example.com/x.jpg')).toBe(false);
	});

	it('RED BUG-387: rejects S3 image URLs when no upload allowlist is configured', () => {
		vi.stubEnv('S3_PUBLIC_URL', '');
		vi.stubEnv('S3_BUCKET', '');
		vi.stubEnv('AWS_REGION', '');

		expect(isAllowedImageHost('https://attacker-bucket.s3.amazonaws.com/x.jpg')).toBe(false);
		expect(imageUrlSchema.safeParse('https://attacker-bucket.s3.amazonaws.com/x.jpg').success).toBe(
			false,
		);
	});

	it('rejects malformed URLs', () => {
		expect(isAllowedImageHost('not a url')).toBe(false);
		expect(isAllowedImageHost('')).toBe(false);
	});
});

describe('imageUrlSchema', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('accepts empty string (legacy "no image")', () => {
		const result = imageUrlSchema.safeParse('');
		expect(result.success).toBe(true);
	});

	it('accepts null and undefined', () => {
		expect(imageUrlSchema.safeParse(null).success).toBe(true);
		expect(imageUrlSchema.safeParse(undefined).success).toBe(true);
	});

	it('rejects javascript: in non-empty string', () => {
		const result = imageUrlSchema.safeParse('javascript:alert(1)');
		expect(result.success).toBe(false);
	});

	it('rejects strings longer than 2048 chars', () => {
		const long = `https://x.s3.amazonaws.com/${'a'.repeat(2100)}`;
		expect(imageUrlSchema.safeParse(long).success).toBe(false);
	});

	it('accepts a valid S3 https URL', () => {
		vi.stubEnv('S3_PUBLIC_URL', 'https://manawg.s3.eu-central-1.amazonaws.com');
		const result = imageUrlSchema.safeParse(
			'https://manawg.s3.eu-central-1.amazonaws.com/manawg/x/expense/abc.jpg',
		);
		expect(result.success).toBe(true);
	});
});

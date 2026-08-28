import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('hashPayload', () => {
	it('returns the SHA-256 hex digest of UTF-8 input', async () => {
		const { hashPayload } = await import('./import-hash');
		const payload = 'Hallo Welt.';
		const expected = createHash('sha256').update(payload, 'utf8').digest('hex');
		expect(hashPayload(payload)).toBe(expected);
		expect(hashPayload(payload)).toHaveLength(64);
	});

	it('matches the known SHA-256 digest for an empty string', async () => {
		const { hashPayload } = await import('./import-hash');
		expect(hashPayload('')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	it('produces different digests for different inputs', async () => {
		const { hashPayload } = await import('./import-hash');
		expect(hashPayload('a')).not.toBe(hashPayload('b'));
	});

	it('handles Unicode payloads', async () => {
		const { hashPayload } = await import('./import-hash');
		const payload = 'Mietnebenkosten — Müller';
		const expected = createHash('sha256').update(payload, 'utf8').digest('hex');
		expect(hashPayload(payload)).toBe(expected);
	});
});

import { describe, expect, it } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
	it('keeps safe relative paths', () => {
		expect(safeNextPath('/w/abc')).toBe('/w/abc');
		expect(safeNextPath('/')).toBe('/');
	});

	it('falls back for external, protocol-relative, and malformed paths', () => {
		expect(safeNextPath('https://evil.example')).toBe('/');
		expect(safeNextPath('//evil.example')).toBe('/');
		expect(safeNextPath('\\evil.example')).toBe('/');
		expect(safeNextPath('w/abc')).toBe('/');
		expect(safeNextPath(null)).toBe('/');
	});
});

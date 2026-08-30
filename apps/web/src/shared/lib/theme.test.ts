import { describe, expect, it } from 'vitest';
import { parseStoredTheme, resolveTheme } from './theme';

describe('theme helpers', () => {
	it('accepts stored app theme values and falls back to system when nothing valid is stored', () => {
		expect(parseStoredTheme('dark')).toBe('dark');
		expect(parseStoredTheme('light')).toBe('light');
		expect(parseStoredTheme('system')).toBe('system');
		expect(parseStoredTheme(null)).toBe('system');
		expect(parseStoredTheme('neon')).toBe('system');
	});

	it('resolves system themes with the current media preference', () => {
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('system', false)).toBe('light');
		expect(resolveTheme('dark', false)).toBe('dark');
	});
});

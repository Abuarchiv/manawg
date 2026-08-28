import { describe, expect, it } from 'vitest';
import { getSettingsTabFromHash } from './settings-tabs';

describe('getSettingsTabFromHash', () => {
	it('maps known hashes to settings tabs and falls back to profile', () => {
		expect(getSettingsTabFromHash('#zugang')).toBe('access');
		expect(getSettingsTabFromHash('#daten')).toBe('data');
		expect(getSettingsTabFromHash('#nope')).toBe('profile');
	});
});

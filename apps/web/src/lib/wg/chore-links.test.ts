import { describe, expect, it } from 'vitest';

import { getChoreHighlightPath } from './chore-links';

describe('chore links', () => {
	it('builds encoded WG-local highlight paths for chores', () => {
		expect(getChoreHighlightPath('chore 1&open=true')).toBe(
			'/putzen?highlight=chore%201%26open%3Dtrue',
		);
	});
});

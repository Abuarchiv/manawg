import { expect, test } from '@playwright/test';
import { initials } from '../src/components/wg/MemberAvatar';

// Stays a Playwright spec because the component module is `.tsx`, which the node test runner
// cannot load; Playwright's transform can.
test('avatar initials never cut an emoji in half', () => {
	expect(initials('😀 Max')).toBe('😀M');
	expect(initials('😀😀😀')).toBe('😀😀');
});

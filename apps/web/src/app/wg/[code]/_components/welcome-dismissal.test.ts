import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWelcomeHidden, welcomeDismissalValue } from './welcome-dismissal';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9);

test('a solo dismissal snoozes the card for seven days', () => {
	const stored = welcomeDismissalValue(NOW, true);
	assert.equal(isWelcomeHidden(stored, NOW + 6 * DAY, true), true);
	assert.equal(isWelcomeHidden(stored, NOW + 7 * DAY, true), false);
});

test('the legacy permanent value counts as expired while solo', () => {
	assert.equal(isWelcomeHidden('1', NOW, true), false);
});

test('a dismissal with flatmates is permanent', () => {
	assert.equal(welcomeDismissalValue(NOW, false), '1');
	assert.equal(isWelcomeHidden('1', NOW + 400 * DAY, false), true);
});

test('a snooze from the solo time does not hide the card once a flatmate joined', () => {
	assert.equal(isWelcomeHidden(String(NOW), NOW + DAY, false), false);
});

test('without a stored value the card shows', () => {
	assert.equal(isWelcomeHidden(null, NOW, true), false);
	assert.equal(isWelcomeHidden(null, NOW, false), false);
});

test('a garbled value does not hide the card', () => {
	assert.equal(isWelcomeHidden('abc', NOW, true), false);
});

test('a snooze timestamp from the future does not hide the card', () => {
	assert.equal(isWelcomeHidden(String(NOW + 30 * DAY), NOW, true), false);
});

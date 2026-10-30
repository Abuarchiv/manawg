import assert from 'node:assert/strict';
import test from 'node:test';
import { subNavBadgeColor } from './sub-nav-badge';

test('active sub-tab badge is stronger than muted text', () => {
	assert.equal(subNavBadgeColor(true), 'text-foreground/80');
	assert.equal(subNavBadgeColor(false), 'text-muted-foreground');
});

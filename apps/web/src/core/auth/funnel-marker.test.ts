import assert from 'node:assert/strict';
import test from 'node:test';
import { funnelMarkerForSession, readFunnelMarker } from './funnel-marker';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test('the first session of a just-confirmed account is the sign-up, not a login', () => {
	const user = { created_at: at(3 * 86_400_000), email_confirmed_at: at(5_000) };
	assert.equal(
		funnelMarkerForSession({ user, next: '/login', hadSession: false, now: NOW }),
		'signup_confirmed',
	);
});

test('a first Google sign-in counts as the sign-up (no confirmation time, created just now)', () => {
	const user = { created_at: at(2_000) };
	assert.equal(
		funnelMarkerForSession({ user, next: '/login', hadSession: false, now: NOW }),
		'signup_confirmed',
	);
});

test('a returning account is a login', () => {
	const user = { created_at: at(30 * 86_400_000), email_confirmed_at: at(30 * 86_400_000) };
	assert.equal(
		funnelMarkerForSession({ user, next: '/login', hadSession: false, now: NOW }),
		'login_completed',
	);
});

test('password recovery and a browser that was already signed in are no login', () => {
	const user = { created_at: at(30 * 86_400_000), email_confirmed_at: at(30 * 86_400_000) };
	assert.equal(
		funnelMarkerForSession({ user, next: '/auth/reset', hadSession: false, now: NOW }),
		null,
	);
	assert.equal(
		funnelMarkerForSession({ user, next: '/settings', hadSession: true, now: NOW }),
		null,
	);
});

test('only the two known markers are read from the cookie header', () => {
	assert.equal(readFunnelMarker('a=1; manawg_funnel=signup_confirmed; b=2'), 'signup_confirmed');
	assert.equal(readFunnelMarker('manawg_funnel=login_completed'), 'login_completed');
	assert.equal(readFunnelMarker('manawg_funnel=wg_created'), null);
	assert.equal(readFunnelMarker('other_manawg_funnel=login_completed'), null);
	assert.equal(readFunnelMarker(''), null);
});

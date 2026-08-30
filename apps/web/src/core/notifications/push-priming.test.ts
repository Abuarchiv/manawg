import { describe, expect, it } from 'vitest';
import {
	isPushPrimingDismissed,
	shouldAutoResubscribePush,
	shouldShowPushPriming,
} from './push-priming';

const BASE = {
	supported: true,
	configured: true,
	permission: 'default' as const,
	dismissed: false,
	editingTarget: false,
};

describe('isPushPrimingDismissed', () => {
	it('treats any stored value as a permanent dismissal, unlike the install-prompt cooldown', () => {
		expect(isPushPrimingDismissed(null)).toBe(false);
		expect(isPushPrimingDismissed('1700000000000')).toBe(true);
		expect(isPushPrimingDismissed('anything')).toBe(true);
	});
});

describe('shouldShowPushPriming', () => {
	it('shows when the browser supports push, it is configured, and nothing has decided yet', () => {
		expect(shouldShowPushPriming(BASE)).toBe(true);
	});

	it('never shows without push support', () => {
		expect(shouldShowPushPriming({ ...BASE, supported: false, permission: null })).toBe(false);
	});

	it('never shows when VAPID is not configured (local dev)', () => {
		expect(shouldShowPushPriming({ ...BASE, configured: false })).toBe(false);
	});

	it('never shows once permission is granted', () => {
		expect(shouldShowPushPriming({ ...BASE, permission: 'granted' })).toBe(false);
	});

	it('never shows once permission is denied', () => {
		expect(shouldShowPushPriming({ ...BASE, permission: 'denied' })).toBe(false);
	});

	it('never shows again after a prior dismissal', () => {
		expect(shouldShowPushPriming({ ...BASE, dismissed: true })).toBe(false);
	});

	it('never shows while an input/textarea/contentEditable is focused', () => {
		expect(shouldShowPushPriming({ ...BASE, editingTarget: true })).toBe(false);
	});
});

const AUTO_BASE = {
	supported: true,
	configured: true,
	permission: 'granted' as const,
	hasSubscription: false,
};

describe('shouldAutoResubscribePush', () => {
	it('resubscribes silently when permission is already granted and no subscription exists', () => {
		expect(shouldAutoResubscribePush(AUTO_BASE)).toBe(true);
	});

	it('never fires without push support', () => {
		expect(shouldAutoResubscribePush({ ...AUTO_BASE, supported: false, permission: null })).toBe(
			false,
		);
	});

	it('never fires when VAPID is not configured (local dev)', () => {
		expect(shouldAutoResubscribePush({ ...AUTO_BASE, configured: false })).toBe(false);
	});

	it('never requests permission itself — only granted counts, not default', () => {
		expect(shouldAutoResubscribePush({ ...AUTO_BASE, permission: 'default' })).toBe(false);
	});

	it('never fires once permission was denied', () => {
		expect(shouldAutoResubscribePush({ ...AUTO_BASE, permission: 'denied' })).toBe(false);
	});

	it('does nothing when a live subscription already exists', () => {
		expect(shouldAutoResubscribePush({ ...AUTO_BASE, hasSubscription: true })).toBe(false);
	});
});

import { PUSH_PRIMING_DISMISS_KEY } from '@/core/notifications/push-priming';
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushPrimingPrompt } from './push-priming-prompt';

const subscribeMock = vi.hoisted(() => vi.fn());

vi.mock('@/core/notifications/push-subscribe', () => ({
	subscribeWebPush: subscribeMock,
}));

function stubPushSupport(): void {
	vi.stubGlobal('Notification', { permission: 'default' });
	Object.defineProperty(window.navigator, 'serviceWorker', {
		value: {},
		configurable: true,
	});
	vi.stubGlobal('PushManager', class {});
}

function stubPushSupportGranted(hasSubscription: boolean): void {
	vi.stubGlobal('Notification', { permission: 'granted' });
	const getSubscription = vi
		.fn()
		.mockResolvedValue(hasSubscription ? { endpoint: 'https://push.example/x' } : null);
	Object.defineProperty(window.navigator, 'serviceWorker', {
		value: {
			getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription } }),
		},
		configurable: true,
	});
	vi.stubGlobal('PushManager', class {});
}

async function flushMicrotasks(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe('PushPrimingPrompt', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AQID');
		stubPushSupport();
		subscribeMock.mockReset().mockResolvedValue(undefined);
	});

	afterEach(() => {
		window.localStorage.clear();
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('does not appear while an input is focused, and appears once focus moves away', () => {
		render(
			<>
				<PushPrimingPrompt code="ABCD1234" memberId="member-1" />
				<input aria-label="Nachricht schreiben" />
			</>,
		);
		screen.getByLabelText('Nachricht schreiben').focus();
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(
			screen.queryByRole('status', { name: 'Benachrichtigungen aktivieren' }),
		).not.toBeInTheDocument();
	});

	it('shows once when push is supported, configured, and permission is still default', () => {
		render(<PushPrimingPrompt code="ABCD1234" memberId="member-1" />);
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(
			screen.getByRole('status', { name: 'Benachrichtigungen aktivieren' }),
		).toBeInTheDocument();
	});

	it('does not show again once dismissed on this device', () => {
		window.localStorage.setItem(PUSH_PRIMING_DISMISS_KEY, String(Date.now()));
		render(<PushPrimingPrompt code="ABCD1234" memberId="member-1" />);
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(
			screen.queryByRole('status', { name: 'Benachrichtigungen aktivieren' }),
		).not.toBeInTheDocument();
	});

	it('remembers the dismissal and hides when the close button is tapped', () => {
		render(<PushPrimingPrompt code="ABCD1234" memberId="member-1" />);
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		act(() => {
			screen.getByRole('button', { name: 'Hinweis schließen' }).click();
		});
		expect(
			screen.queryByRole('status', { name: 'Benachrichtigungen aktivieren' }),
		).not.toBeInTheDocument();
		expect(window.localStorage.getItem(PUSH_PRIMING_DISMISS_KEY)).not.toBeNull();
	});

	it('only requests the native permission from the affirmative tap, never automatically', async () => {
		render(<PushPrimingPrompt code="ABCD1234" memberId="member-1" memberToken="tok" />);
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(subscribeMock).not.toHaveBeenCalled();

		await act(async () => {
			screen.getByRole('button', { name: /Ja, aktivieren/ }).click();
		});
		expect(subscribeMock).toHaveBeenCalledWith('ABCD1234', 'member-1', 'tok');
	});

	it('silently resubscribes when permission is already granted but this device has no subscription', async () => {
		stubPushSupportGranted(false);
		await act(async () => {
			render(<PushPrimingPrompt code="ABCD1234" memberId="member-1" memberToken="tok" />);
		});
		await flushMicrotasks();
		expect(subscribeMock).toHaveBeenCalledWith('ABCD1234', 'member-1', 'tok');
		// No gesture involved — the card itself never shows for granted permission.
		expect(
			screen.queryByRole('status', { name: 'Benachrichtigungen aktivieren' }),
		).not.toBeInTheDocument();
	});

	it('does not resubscribe when a live subscription already exists', async () => {
		stubPushSupportGranted(true);
		await act(async () => {
			render(<PushPrimingPrompt code="ABCD1234" memberId="member-1" memberToken="tok" />);
		});
		await flushMicrotasks();
		expect(subscribeMock).not.toHaveBeenCalled();
	});
});

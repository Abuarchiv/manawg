// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatChannel } from './chat-channel';

const POLL_INTERVAL_MS = 8000;

describe('useChatChannel polling', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(document, 'hidden', { value: false, configurable: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not invoke onMessageCreated before the polling interval elapses', async () => {
		const onMessageCreated = vi.fn();
		renderHook(() => useChatChannel('wg-1', { onMessageCreated }));
		await act(async () => {
			await Promise.resolve();
		});

		act(() => {
			vi.advanceTimersByTime(POLL_INTERVAL_MS - 1);
		});
		expect(onMessageCreated).not.toHaveBeenCalled();
	});

	it('invokes onMessageCreated once per polling interval', async () => {
		const onMessageCreated = vi.fn();
		renderHook(() => useChatChannel('wg-1', { onMessageCreated }));
		await act(async () => {
			await Promise.resolve();
		});

		act(() => {
			vi.advanceTimersByTime(POLL_INTERVAL_MS);
		});
		expect(onMessageCreated).toHaveBeenCalledTimes(1);

		act(() => {
			vi.advanceTimersByTime(POLL_INTERVAL_MS);
		});
		expect(onMessageCreated).toHaveBeenCalledTimes(2);
	});

	it('pauses polling when the document is hidden', async () => {
		const onMessageCreated = vi.fn();
		renderHook(() => useChatChannel('wg-1', { onMessageCreated }));
		await act(async () => {
			await Promise.resolve();
		});

		Object.defineProperty(document, 'hidden', { value: true, configurable: true });
		act(() => {
			vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
		});
		expect(onMessageCreated).not.toHaveBeenCalled();

		Object.defineProperty(document, 'hidden', { value: false, configurable: true });
		act(() => {
			vi.advanceTimersByTime(POLL_INTERVAL_MS);
		});
		expect(onMessageCreated).toHaveBeenCalledTimes(1);
	});
});

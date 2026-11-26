import type { Page } from '@playwright/test';

export interface StrictCall {
	via: 'share' | 'copy';
	inClick: boolean;
	text: string;
}

/**
 * A strict browser: the share sheet and the clipboard only work inside the tap itself, and an
 * awaited request ends the tap. `ClipboardItem` takes a promise, so a write started inside the tap
 * may resolve later. Every call lands in `window.__strict`.
 */
export async function strictBrowser(page: Page): Promise<() => Promise<StrictCall[]>> {
	await page.addInitScript(() => {
		let inClick = false;
		const calls: StrictCall[] = [];
		(window as unknown as { __strict: StrictCall[] }).__strict = calls;
		window.addEventListener('click', () => (inClick = true), true);
		window.addEventListener('click', () => setTimeout(() => (inClick = false)));
		// The timer alone races a mocked answer, which can arrive first on a busy runner.
		const nativeFetch = window.fetch.bind(window);
		window.fetch = async (...args) => {
			try {
				return await nativeFetch(...args);
			} finally {
				inClick = false;
			}
		};
		Object.defineProperty(navigator, 'userActivation', {
			value: {
				get isActive() {
					return inClick;
				},
			},
			configurable: true,
		});
		Object.defineProperty(navigator, 'share', {
			value: async (data: { text: string }) =>
				void calls.push({ via: 'share', inClick, text: data.text }),
			configurable: true,
		});
		Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
		class FakeClipboardItem {
			readonly items: Record<string, Promise<Blob> | Blob>;
			constructor(items: Record<string, Promise<Blob> | Blob>) {
				this.items = items;
			}
		}
		Object.defineProperty(window, 'ClipboardItem', {
			value: FakeClipboardItem,
			configurable: true,
		});
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				writeText: async (text: string) => {
					if (!inClick) throw new DOMException('no gesture', 'NotAllowedError');
					calls.push({ via: 'copy', inClick, text });
				},
				write: async (items: FakeClipboardItem[]) => {
					if (!inClick) throw new DOMException('no gesture', 'NotAllowedError');
					const blob = await items[0]?.items['text/plain'];
					calls.push({ via: 'copy', inClick: true, text: (await blob?.text()) ?? '' });
				},
			},
			configurable: true,
		});
	});
	return () => page.evaluate(() => (window as unknown as { __strict: StrictCall[] }).__strict);
}

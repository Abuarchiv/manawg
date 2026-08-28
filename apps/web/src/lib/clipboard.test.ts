// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, copyViaTextArea } from './clipboard';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('copyViaTextArea', () => {
	it('copies through a textarea and leaves no node behind', () => {
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

		expect(copyViaTextArea('MTE8PZAT')).toBe(true);
		expect(execCommand).toHaveBeenCalledWith('copy');
		expect(document.querySelector('textarea')).toBeNull();
	});

	it('reports failure and still removes the textarea when execCommand throws', () => {
		Object.defineProperty(document, 'execCommand', {
			value: () => {
				throw new Error('not allowed');
			},
			configurable: true,
		});

		expect(copyViaTextArea('MTE8PZAT')).toBe(false);
		expect(document.querySelector('textarea')).toBeNull();
	});
});

describe('copyText', () => {
	it('uses the async clipboard when it works', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		await expect(copyText('MTE8PZAT')).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith('MTE8PZAT');
	});

	it('falls back to the textarea when the async clipboard rejects', async () => {
		vi.stubGlobal('navigator', {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error('not focused')) },
		});
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

		await expect(copyText('MTE8PZAT')).resolves.toBe(true);
		expect(execCommand).toHaveBeenCalledWith('copy');
	});
});

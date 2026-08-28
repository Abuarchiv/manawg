import {
	ALERT_DANGER,
	ALERT_DANGER_ROW,
	CHIP_BUTTON,
	EMPTY_PLACEHOLDER,
	FIELD_INPUT,
	ICON_BUTTON,
	ICON_BUTTON_BORDERED,
	LIST_CARD,
} from '@/components/ui/styles';
import { TEXT_LINK } from '@manawg/shared/lib/text-link';
import { describe, expect, it } from 'vitest';

describe('shared class constants match the strings they replaced', () => {
	it('renders byte-identical class lists', () => {
		expect(FIELD_INPUT).toBe(
			'block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
		);
		expect(ALERT_DANGER).toBe(
			'rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]',
		);
		expect(ALERT_DANGER_ROW).toBe(
			'flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]',
		);
		expect(LIST_CARD).toBe(
			'divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]',
		);
		expect(ICON_BUTTON).toBe(
			'inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
		);
		expect(ICON_BUTTON_BORDERED).toBe(
			'inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
		);
		expect(CHIP_BUTTON).toBe(
			'inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
		);
		expect(EMPTY_PLACEHOLDER).toBe(
			'rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-3)]',
		);
		expect(TEXT_LINK).toBe(
			'underline underline-offset-2 transition-colors hover:text-[var(--text-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-sm',
		);
	});
});

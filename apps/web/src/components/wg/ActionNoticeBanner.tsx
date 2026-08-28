'use client';

export type ActionNoticeTone = 'error' | 'warning' | 'success';

export interface ActionNotice {
	message: string;
	tone: ActionNoticeTone;
}

const TONE_CLASSES: Record<ActionNoticeTone, string> = {
	success: 'border-[var(--accent)]/30 bg-[var(--accent)]/5 text-[var(--accent)]',
	warning: 'border-[var(--warning)]/30 bg-[var(--warning)]/5 text-[var(--warning)]',
	error: 'border-[var(--danger)]/30 bg-[var(--danger)]/5 text-[var(--danger)]',
};

export function ActionNoticeBanner({ notice }: { notice: ActionNotice }) {
	const className = `block rounded-md border px-3 py-2 text-[13px] ${TONE_CLASSES[notice.tone]}`;

	// Errors interrupt (role="alert"); success/warning announce politely.
	if (notice.tone === 'error') {
		return (
			<div role="alert" className={className}>
				{notice.message}
			</div>
		);
	}

	return (
		<output className={className} aria-live="polite">
			{notice.message}
		</output>
	);
}

'use client';

import { Download, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Props {
	shareCode: string;
	expenseCount: number;
}

const EXPENSE_HINT_THRESHOLD = 5;
const STORAGE_PREFIX = 'manawg.dismissed_import_hint.';

function dismissalKey(shareCode: string): string {
	return `${STORAGE_PREFIX}${shareCode}`;
}

function isDismissed(shareCode: string): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return window.localStorage.getItem(dismissalKey(shareCode)) === '1';
	} catch {
		return false;
	}
}

export function ImportCard({ shareCode, expenseCount }: Props) {
	const encoded = encodeURIComponent(shareCode);
	const href = `/wg/${encoded}/import`;
	const [dismissed, setDismissed] = useState<boolean>(true);

	useEffect(() => {
		setDismissed(isDismissed(shareCode));
	}, [shareCode]);

	if (expenseCount >= EXPENSE_HINT_THRESHOLD) return null;
	if (dismissed) return null;

	function handleDismiss(event: React.MouseEvent<HTMLButtonElement>): void {
		event.preventDefault();
		event.stopPropagation();
		if (typeof window !== 'undefined') {
			try {
				window.localStorage.setItem(dismissalKey(shareCode), '1');
			} catch {
				// localStorage may be unavailable; we still hide the card in-memory
			}
		}
		setDismissed(true);
	}

	return (
		<div className="relative flex h-full flex-col rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
			<button
				type="button"
				onClick={handleDismiss}
				aria-label="Hinweis ausblenden"
				className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			>
				<X className="h-3.5 w-3.5" aria-hidden />
			</button>
			<header className="flex items-center gap-2 pr-7">
				<Download
					className="h-4 w-4 shrink-0 text-[var(--accent)]"
					strokeWidth={1.75}
					aria-hidden
				/>
				<h2 className="text-[13px] font-medium text-[var(--text-2)]">Import</h2>
			</header>
			<p className="mt-2 flex-1 text-[12.5px] text-[var(--text-2)]">
				Wechselst du von Splitwise oder Splid? Importiere deine Historie.
			</p>
			<Link
				href={href}
				className="mt-3 inline-flex h-11 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			>
				Importieren
			</Link>
		</div>
	);
}

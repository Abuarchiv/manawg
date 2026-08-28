'use client';

import { type NavigatorWithShare, copyViaTextArea } from '@/lib/clipboard';
import { AlertTriangle, Check, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const RESET_MS = 1500;

interface CopyCodeButtonProps {
	code: string;
	wgName?: string;
	joiningEnabled?: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyCodeButton({ code, wgName, joiningEnabled = true }: CopyCodeButtonProps) {
	const [state, setState] = useState<CopyState>('idle');
	const [sharing, setSharing] = useState(false);
	const timerRef = useRef<number | null>(null);
	const sharingRef = useRef(false);

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		};
	}, []);

	function flash(next: CopyState): void {
		setState(next);
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => {
			setState('idle');
			timerRef.current = null;
		}, RESET_MS);
	}

	async function onClick(): Promise<void> {
		if (!joiningEnabled) return;
		if (sharingRef.current) return;
		sharingRef.current = true;
		setSharing(true);
		const url =
			typeof window !== 'undefined'
				? `${window.location.origin}/neu?code=${encodeURIComponent(code)}`
				: `/neu?code=${encodeURIComponent(code)}`;
		const host = typeof window !== 'undefined' ? window.location.host : '';
		const text = wgName
			? `Komm in unsere WG "${wgName}" auf ManaWG: ${url}\n(oder mit Code ${code} unter ${host} beitreten)`
			: `Komm in unsere WG auf ManaWG: ${url}\n(oder mit Code ${code})`;
		const shareData = { title: 'ManaWG', text, url };

		try {
			const nav = (typeof navigator !== 'undefined' ? navigator : null) as
				| (Navigator & NavigatorWithShare)
				| null;
			if (nav?.share && (!nav.canShare || nav.canShare(shareData))) {
				await nav.share(shareData);
				flash('copied');
				return;
			}
			if (nav?.clipboard?.writeText) {
				await nav.clipboard.writeText(text);
				flash('copied');
				return;
			}
			flash(copyViaTextArea(text) ? 'copied' : 'failed');
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				setState('idle');
				return;
			}
			flash(copyViaTextArea(text) ? 'copied' : 'failed');
		} finally {
			sharingRef.current = false;
			setSharing(false);
		}
	}

	const label = !joiningEnabled
		? 'Neue Beitritte sind gesperrt'
		: sharing
			? 'WG wird geteilt…'
			: state === 'copied'
				? 'WG geteilt'
				: state === 'failed'
					? 'Teilen fehlgeschlagen'
					: `WG-Code ${code} teilen`;

	const statusMessage =
		state === 'copied' ? 'WG geteilt' : state === 'failed' ? 'Teilen fehlgeschlagen' : '';

	return (
		<>
			<output aria-live="polite" className="sr-only">
				{statusMessage}
			</output>
			<button
				type="button"
				onClick={onClick}
				disabled={!joiningEnabled || sharing}
				className="inline-flex h-11 min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-[12.5px] font-medium tracking-wider text-[var(--text-1)] shadow-sm transition-[transform,background-color,border-color] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-[var(--border)] disabled:hover:bg-[var(--bg-base)] sm:w-auto sm:px-2.5"
				aria-label={label}
			>
				<span aria-hidden className="hidden sm:inline">
					{joiningEnabled ? code : 'Gesperrt'}
				</span>
				{!joiningEnabled ? (
					<AlertTriangle className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden />
				) : state === 'copied' ? (
					<Check className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden />
				) : state === 'failed' ? (
					<AlertTriangle className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden />
				) : (
					<Share2 className="h-3.5 w-3.5 text-[var(--text-3)]" aria-hidden />
				)}
			</button>
		</>
	);
}

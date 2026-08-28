'use client';

import { type NavigatorWithShare, copyText } from '@/core/utils/clipboard';
import { AlertTriangle, Check, Share2 } from 'lucide-react';
import { useRef, useState } from 'react';

const SHARE_RESET_MS = 1500;

type ShareState = 'idle' | 'shared' | 'failed';

interface InviteStepProps {
	code: string;
	wgName: string;
	onSkip: () => void;
}

export function InviteStep({ code, wgName, onSkip }: InviteStepProps) {
	const [state, setState] = useState<ShareState>('idle');
	const [sharing, setSharing] = useState<'invite' | 'code' | null>(null);
	const timerRef = useRef<number | null>(null);
	const sharingRef = useRef(false);
	// Visually hidden live region so screen readers announce share state changes
	// without re-reading the entire button label each time.
	const liveId = 'share-status-live';

	function flash(next: ShareState): void {
		setState(next);
		if (timerRef.current) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => setState('idle'), SHARE_RESET_MS);
	}

	async function onShare(): Promise<void> {
		if (sharingRef.current) return;
		sharingRef.current = true;
		setSharing('invite');
		const url =
			typeof window !== 'undefined'
				? `${window.location.origin}/neu?code=${code}`
				: `/neu?code=${code}`;
		const host = typeof window !== 'undefined' ? window.location.host : '';
		const text = `Komm in unsere WG "${wgName}" auf ManaWG: ${url}\n(oder mit Code ${code} unter ${host} beitreten)`;
		const shareData = { title: 'ManaWG', text, url };
		try {
			const nav = (typeof navigator !== 'undefined' ? navigator : null) as
				| (Navigator & NavigatorWithShare)
				| null;
			if (nav?.share && (!nav.canShare || nav.canShare(shareData))) {
				await nav.share(shareData);
				flash('shared');
				return;
			}
			flash((await copyText(text)) ? 'shared' : 'failed');
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				setState('idle');
				return;
			}
			flash((await copyText(text)) ? 'shared' : 'failed');
		} finally {
			sharingRef.current = false;
			setSharing(null);
		}
	}

	async function onCopyCode(): Promise<void> {
		if (sharingRef.current) return;
		sharingRef.current = true;
		setSharing('code');
		try {
			flash((await copyText(code)) ? 'shared' : 'failed');
		} finally {
			sharingRef.current = false;
			setSharing(null);
		}
	}

	const whatsappHref = `https://wa.me/?text=${encodeURIComponent(
		`Komm in unsere WG "${wgName}" auf ManaWG: ${typeof window !== 'undefined' ? `${window.location.origin}/neu?code=${code}` : `/neu?code=${code}`}\n(oder mit Code ${code} unter ${typeof window !== 'undefined' ? window.location.host : ''} beitreten)`,
	)}`;

	const shareLabel =
		sharing === 'invite'
			? 'Einladung wird geteilt…'
			: state === 'shared'
				? 'Geteilt'
				: state === 'failed'
					? 'Teilen fehlgeschlagen'
					: 'Mitbewohner einladen';
	const sharingBlocked = sharing !== null;

	return (
		<div className="space-y-5">
			{/* Visually hidden live region for share status announcements */}
			<span id={liveId} aria-live="polite" aria-atomic="true" className="sr-only">
				{state === 'shared'
					? 'Link wurde geteilt.'
					: state === 'failed'
						? 'Teilen fehlgeschlagen.'
						: ''}
			</span>

			<div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] p-6 text-center shadow-sm">
				<div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
					<Check className="h-6 w-6" aria-hidden />
				</div>
				{/* Truncate long WG names so the card doesn't overflow */}
				<div className="truncate text-[15px] font-medium text-[var(--text-1)]">
					{wgName} ist live.
				</div>
				<button
					type="button"
					onClick={() => void onCopyCode()}
					disabled={sharing !== null}
					aria-label={sharing === 'code' ? `Code ${code} wird kopiert…` : `Code ${code} kopieren`}
					className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-mono text-[22px] font-semibold tracking-[0.22em] text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{code}
				</button>
				<p className="mt-3 text-[12px] text-[var(--text-3)]">
					Tippe auf den Code zum Kopieren, oder teile direkt unten.
				</p>
			</div>

			<div className="space-y-2">
				<button
					type="button"
					onClick={() => void onShare()}
					disabled={sharing !== null}
					aria-label={shareLabel}
					aria-describedby={liveId}
					className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--text-1)] text-[15px] font-semibold text-[var(--bg-base)] transition-opacity hover:opacity-90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{state === 'shared' ? (
						<Check className="h-4 w-4" aria-hidden />
					) : state === 'failed' ? (
						<AlertTriangle className="h-4 w-4" aria-hidden />
					) : (
						<Share2 className="h-4 w-4" aria-hidden />
					)}
					<span aria-hidden="true">{shareLabel}</span>
				</button>
				<a
					href={whatsappHref}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="Per WhatsApp teilen"
					aria-disabled={sharingBlocked}
					tabIndex={sharingBlocked ? -1 : undefined}
					onClick={(event) => {
						if (sharingBlocked) event.preventDefault();
					}}
					className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-all hover:bg-[#1ebe5a] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 ${
						sharingBlocked ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
					}`}
				>
					<svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
						<path d="M20.52 3.48A11.78 11.78 0 0 0 12.01 0C5.42 0 .07 5.35.07 11.94c0 2.1.55 4.16 1.6 5.97L0 24l6.27-1.64a11.93 11.93 0 0 0 5.74 1.46h.01c6.59 0 11.93-5.35 11.93-11.94 0-3.19-1.24-6.18-3.43-8.4Zm-8.51 18.34h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.22-3.72.97.99-3.63-.24-.37a9.93 9.93 0 1 1 8.39 4.63Zm5.45-7.43c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.66.15-.2.3-.76.97-.93 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.34.45-.51.15-.17.2-.3.3-.49.1-.2.05-.37-.02-.52-.07-.15-.66-1.6-.91-2.18-.24-.57-.49-.49-.66-.5h-.56c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47s1.07 2.86 1.22 3.06c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35Z" />
					</svg>
					Per WhatsApp teilen
				</a>
			</div>

			<button
				type="button"
				onClick={onSkip}
				disabled={sharingBlocked}
				className="mt-4 block w-full rounded-xl border border-[var(--border)] px-4 py-3 text-center text-[14px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
			>
				Später → direkt zur WG
			</button>
		</div>
	);
}

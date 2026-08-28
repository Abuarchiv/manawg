'use client';

import { copyViaTextArea } from '@/core/utils/clipboard';
import { Check, Copy, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';

interface Props {
	wgName: string;
	shareCode: string;
	appUrl?: string;
	hideHeader?: boolean;
	joiningEnabled?: boolean;
}

const COPY_FEEDBACK_MS = 1500;

function buildShareUrl(shareCode: string, explicitAppUrl?: string): string {
	if (explicitAppUrl) {
		return `${explicitAppUrl.replace(/\/$/, '')}/neu?code=${encodeURIComponent(shareCode)}`;
	}
	if (typeof window !== 'undefined') {
		return `${window.location.origin}/neu?code=${encodeURIComponent(shareCode)}`;
	}
	return `/neu?code=${encodeURIComponent(shareCode)}`;
}

export function ShareWgCard({
	wgName,
	shareCode,
	appUrl,
	hideHeader = false,
	joiningEnabled = true,
}: Props) {
	const [copied, setCopied] = useState<'code' | 'link' | null>(null);
	const [copyError, setCopyError] = useState<string | null>(null);
	const [copying, setCopying] = useState<'code' | 'link' | 'share' | null>(null);
	const feedbackTimerRef = useRef<number | null>(null);
	const copyingRef = useRef(false);
	const shareUrl = buildShareUrl(shareCode, appUrl);

	useEffect(() => {
		return () => {
			if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
		};
	}, []);

	function showCopied(kind: 'code' | 'link'): void {
		setCopied(kind);
		if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
		feedbackTimerRef.current = window.setTimeout(() => {
			setCopied(null);
			feedbackTimerRef.current = null;
		}, COPY_FEEDBACK_MS);
	}

	async function copy(value: string, kind: 'code' | 'link'): Promise<void> {
		if (!joiningEnabled) return;
		if (copyingRef.current) return;
		copyingRef.current = true;
		setCopying(kind);
		try {
			setCopyError(null);
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(value);
			} else if (!copyViaTextArea(value)) {
				throw new Error('copy_failed');
			}
			showCopied(kind);
		} catch {
			if (copyViaTextArea(value)) {
				showCopied(kind);
				return;
			}
			setCopied(null);
			setCopyError(
				`Kopieren fehlgeschlagen. Markiere ${kind === 'code' ? 'den Code' : 'den Link'} und kopiere ihn manuell.`,
			);
		} finally {
			copyingRef.current = false;
			setCopying(null);
		}
	}

	async function nativeShare(): Promise<void> {
		if (!joiningEnabled) return;
		if (copyingRef.current) return;
		copyingRef.current = true;
		setCopying('share');
		if (typeof navigator === 'undefined' || !('share' in navigator)) {
			copyingRef.current = false;
			setCopying(null);
			await copy(shareUrl, 'link');
			return;
		}
		try {
			await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({
				title: `WG ${wgName} beitreten`,
				text: `Tritt der WG "${wgName}" auf ManaWG bei. Code: ${shareCode}`,
				url: shareUrl,
			});
			showCopied('link');
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') return;
			copyingRef.current = false;
			setCopying(null);
			await copy(shareUrl, 'link');
			return;
		} finally {
			copyingRef.current = false;
			setCopying(null);
		}
	}

	return (
		<div
			className={
				hideHeader ? '' : 'rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-5'
			}
		>
			{!hideHeader && (
				<header className="mb-4">
					<h2 className="text-[13px] font-medium text-[var(--text-1)]">WG teilen</h2>
					<p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
						{joiningEnabled
							? 'Wer Code oder QR scannt, kommt zum Beitrittsflow.'
							: 'Beitritte sind gesperrt. Öffne den Zugang, bevor du teilst.'}
					</p>
				</header>
			)}

			{!joiningEnabled ? (
				<output
					aria-live="polite"
					className="mb-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12.5px] text-[var(--text-2)]"
				>
					Neue Beitritte sind gerade gesperrt. Link, QR und Teilen bleiben blockiert.
				</output>
			) : null}

			<div
				role="img"
				aria-label="QR-Code zum WG-Beitritt"
				className={`mb-4 flex justify-center rounded-md border border-[var(--border)] bg-white p-3 ${
					joiningEnabled ? '' : 'opacity-45 grayscale'
				}`}
			>
				<QRCode value={shareUrl} size={148} level="M" />
			</div>

			<div className="overflow-hidden rounded-md border border-[var(--border)]">
				<button
					type="button"
					onClick={() => copy(shareCode, 'code')}
					disabled={!joiningEnabled || copying !== null}
					aria-label={
						copying === 'code'
							? 'WG-Code wird kopiert…'
							: copied === 'code'
								? 'Code kopiert'
								: 'WG-Code kopieren'
					}
					className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					<div className="min-w-0">
						<div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-3)]">
							Code
						</div>
						<div className="mt-0.5 font-mono text-[15px] font-medium tracking-[0.12em] text-[var(--text-1)]">
							{shareCode}
						</div>
					</div>
					{copied === 'code' ? (
						<Check className="h-4 w-4 text-[var(--accent)]" aria-hidden />
					) : (
						<Copy className="h-4 w-4 text-[var(--text-3)]" aria-hidden />
					)}
				</button>
				<button
					type="button"
					onClick={() => copy(shareUrl, 'link')}
					disabled={!joiningEnabled || copying !== null}
					aria-label={
						copying === 'link'
							? 'Einladungslink wird kopiert…'
							: copied === 'link'
								? 'Link kopiert'
								: 'Einladungslink kopieren'
					}
					className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					<div className="min-w-0">
						<div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-3)]">
							Link
						</div>
						<div className="mt-0.5 truncate text-[13px] text-[var(--text-1)]">{shareUrl}</div>
					</div>
					{copied === 'link' ? (
						<Check className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
					) : (
						<Copy className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden />
					)}
				</button>
			</div>
			{copyError ? (
				<p role="alert" className="mt-2 text-[12px] text-[var(--danger)]">
					{copyError}
				</p>
			) : null}
			{copied === 'link' ? (
				<output aria-live="polite" className="mt-2 block text-[12px] text-[var(--accent)]">
					Einladungslink bereit.
				</output>
			) : null}

			<button
				type="button"
				onClick={nativeShare}
				disabled={!joiningEnabled || copying !== null}
				aria-label={copying === 'share' ? 'WG-Einladung wird geteilt…' : 'WG-Einladung teilen'}
				className="mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--text-1)] text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
			>
				<Share2 className="h-3.5 w-3.5" aria-hidden />
				{copying === 'share' ? 'Teilt…' : 'Teilen'}
			</button>
		</div>
	);
}

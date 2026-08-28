'use client';

import { apiFetch } from '@/lib/api-client';
import { useModalDialog } from '@/lib/hooks/useModalDialog';
import { formatEuroCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

/** One open debt of the member being moved out, from their own perspective. */
interface OpenBalanceDto {
	member_id: string;
	name: string;
	amount_cents: number;
	direction: 'owes' | 'owed';
}

interface MemberDeactivateResponse {
	member: { id: string; name: string; active: boolean };
}

interface OpenBalancesResponse {
	member: { id: string; name: string; active: boolean };
	openBalances: OpenBalanceDto[];
}

interface MemberDeactivateDialogProps {
	/** Already URL-encoded WG share code. */
	encodedShareCode: string;
	member: { id: string; name: string };
	/** Identity of the device performing the action (for the member-id header). */
	viewerMemberId: string;
	onClose: () => void;
	onDeactivated: (name: string) => void;
}

/**
 * Confirmation dialog for marking a member as moved out ("Auszug").
 *
 * On open it fetches the member's open balances and lists them as a warning.
 * The move-out is never blocked by open balances — the decision is "erlauben,
 * aber warnen": we surface the money that would be left hanging and let the
 * user proceed anyway. Deactivation is reversible, so this is not destructive.
 */
export function MemberDeactivateDialog({
	encodedShareCode,
	member,
	viewerMemberId,
	onClose,
	onDeactivated,
}: MemberDeactivateDialogProps) {
	const cancelBtnRef = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const descId = useId();

	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [openBalances, setOpenBalances] = useState<OpenBalanceDto[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const dialogRef = useModalDialog({
		open: true,
		onClose,
		initialFocusRef: cancelBtnRef,
	});

	// Load the open balances once per opened member.
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setLoadError(null);
		void apiFetch<OpenBalancesResponse>(`/api/wg/${encodedShareCode}/members/${member.id}`, {
			memberId: viewerMemberId,
		}).then((res) => {
			if (cancelled) return;
			if (res.ok) {
				setOpenBalances(res.data.openBalances);
			} else {
				setLoadError('Offene Salden konnten nicht geladen werden.');
			}
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [encodedShareCode, member.id, viewerMemberId]);

	async function handleConfirm(): Promise<void> {
		if (submitting) return;
		setSubmitting(true);
		setSubmitError(null);
		const res = await apiFetch<MemberDeactivateResponse>(
			`/api/wg/${encodedShareCode}/members/${member.id}`,
			{
				method: 'PATCH',
				memberId: viewerMemberId,
				body: JSON.stringify({ active: false }),
			},
		);
		if (res.ok) {
			onDeactivated(res.data.member.name);
			onClose();
			return;
		}
		setSubmitError('Auszug konnte nicht gespeichert werden. Bitte erneut versuchen.');
		setSubmitting(false);
	}

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is a mouse-only convenience; keyboard users dismiss via the native <dialog> cancel/Escape event wired in the effect above.
		<dialog
			ref={dialogRef}
			className="fixed inset-0 z-50 m-0 flex max-h-none max-w-none items-end justify-center border-0 bg-black/40 p-0 backdrop-blur-sm sm:items-center"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={descId}
			onClick={(e) => {
				if (e.target === e.currentTarget && !submitting) onClose();
			}}
		>
			<div
				className={cn(
					'relative w-full glass gradient-border outline-none',
					'rounded-t-2xl max-h-[70vh] overflow-y-auto',
					'sm:rounded-2xl sm:max-w-md sm:max-h-[80vh]',
				)}
			>
				<div className="flex items-start gap-3 px-5 pt-6 pb-3">
					<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden />
					<h2 id={titleId} className="text-lg font-semibold text-[var(--text-1)]">
						{member.name} ausziehen?
					</h2>
				</div>

				<div id={descId} className="px-5 pb-2 text-sm leading-relaxed text-[var(--text-2)]">
					<p>
						{member.name} verschwindet aus allen Listen (Rotation, Aufteilung, Auswahl), behält aber
						Zugriff auf dieses Gerät. Historie und Salden bleiben erhalten. Du kannst den Auszug
						jederzeit rückgängig machen.
					</p>

					<div className="mt-4">
						{loading ? (
							<p className="flex items-center gap-2 text-[13px] text-[var(--text-3)]">
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
								Offene Salden werden geprüft …
							</p>
						) : loadError ? (
							<p className="rounded-md border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-3)]">
								{loadError} Der Auszug ist trotzdem möglich.
							</p>
						) : openBalances.length === 0 ? (
							<p className="text-[13px] text-[var(--text-3)]">Keine offenen Salden. 🎉</p>
						) : (
							<div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] px-3 py-2.5">
								<p className="text-[12.5px] font-medium text-[var(--text-1)]">
									Offene Salden bleiben nach dem Auszug bestehen:
								</p>
								<ul className="mt-1.5 space-y-1">
									{openBalances.map((balance) => (
										<li
											key={`${balance.direction}-${balance.member_id}`}
											className="flex items-center justify-between gap-2 text-[13px]"
										>
											<span className="truncate text-[var(--text-2)]">
												{balance.direction === 'owes'
													? `Schuldet ${balance.name}`
													: `${balance.name} schuldet`}
											</span>
											<span className="shrink-0 font-medium tabular-nums text-[var(--text-1)]">
												{formatEuroCents(balance.amount_cents)}
											</span>
										</li>
									))}
								</ul>
							</div>
						)}
					</div>

					{submitError && <p className="mt-3 text-[13px] text-[var(--danger)]">{submitError}</p>}
				</div>

				<div className="flex flex-col gap-2 px-5 pb-6 sm:flex-row sm:justify-end sm:pb-5">
					<button
						ref={cancelBtnRef}
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="w-full min-h-11 btn-modern-ghost px-4 py-3 text-sm font-semibold disabled:opacity-50 sm:w-auto sm:py-2.5"
					>
						Abbrechen
					</button>
					<button
						type="button"
						onClick={() => void handleConfirm()}
						disabled={submitting || loading}
						className="inline-flex w-full min-h-11 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5"
					>
						{submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
						Ausziehen
					</button>
				</div>
			</div>
		</dialog>
	);
}

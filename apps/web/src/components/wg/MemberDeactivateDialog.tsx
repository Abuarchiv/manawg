'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch } from '@/core/infra/api-client';
import { formatEuroCents } from '@/core/utils/money';
import { TriangleAlert as AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

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
	viewerMemberToken?: string | undefined;
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
	viewerMemberToken,
	onClose,
	onDeactivated,
}: MemberDeactivateDialogProps) {
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [openBalances, setOpenBalances] = useState<OpenBalanceDto[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

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
				memberToken: viewerMemberToken,
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
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open && !submitting) onClose();
			}}
		>
			<AlertDialogContent size="default">
				<AlertDialogHeader>
					<AlertDialogMedia>
						<AlertTriangle aria-hidden />
					</AlertDialogMedia>
					<AlertDialogTitle>{member.name} ausziehen?</AlertDialogTitle>
					<AlertDialogDescription>
						{member.name} verschwindet aus allen Listen (Rotation, Aufteilung, Auswahl), behält aber
						Zugriff auf dieses Gerät. Historie und Salden bleiben erhalten. Du kannst den Auszug
						jederzeit rückgängig machen.
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="grid gap-2">
					{loading ? (
						<p className="text-muted-foreground flex min-h-[44px] items-center gap-2 text-[13px]">
							<Spinner aria-hidden />
							Offene Salden werden geprüft …
						</p>
					) : loadError ? (
						<Alert>
							<AlertDescription>{loadError} Der Auszug ist trotzdem möglich.</AlertDescription>
						</Alert>
					) : openBalances.length === 0 ? (
						<p className="text-muted-foreground text-[13px]">Keine offenen Salden.</p>
					) : (
						<Alert>
							<AlertTitle>Offene Salden bleiben nach dem Auszug bestehen:</AlertTitle>
							<AlertDescription>
								<ul className="mt-1.5 grid gap-1">
									{openBalances.map((balance) => (
										<li
											key={`${balance.direction}-${balance.member_id}`}
											className="flex items-center justify-between gap-2 text-[13px]"
										>
											<span className="text-muted-foreground truncate">
												{balance.direction === 'owes'
													? `Schuldet ${balance.name}`
													: `${balance.name} schuldet`}
											</span>
											<span className="text-foreground shrink-0 font-medium tabular-nums">
												{formatEuroCents(balance.amount_cents)}
											</span>
										</li>
									))}
								</ul>
							</AlertDescription>
						</Alert>
					)}

					{submitError && (
						<Alert variant="destructive">
							<AlertDescription>{submitError}</AlertDescription>
						</Alert>
					)}
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel disabled={submitting}>Abbrechen</AlertDialogCancel>
					<AlertDialogAction
						onClick={(event) => {
							event.preventDefault();
							void handleConfirm();
						}}
						disabled={submitting || loading}
					>
						{submitting && <Spinner aria-hidden />}
						Ausziehen
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

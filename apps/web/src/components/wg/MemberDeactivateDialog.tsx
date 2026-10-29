'use client';

import { TriangleAlert as AlertTriangle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { isRateLimited } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { formatEuroCents } from '@/core/utils/money';
import type { Locale } from '@/shared/i18n/locale';
import { useMessage } from '@/shared/i18n/message';

/** One open debt of the member being moved out, from their own perspective. */
interface OpenBalanceDto {
	member_id: string;
	name: string | null;
	amount_cents: number;
	currency: string;
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
	/** Use the same balance review for a member leaving their own WG. */
	selfLeave?: boolean | undefined;
	onClose: () => void;
	onDeactivated: (name: string) => void;
}

/**
 * Confirmation dialog for marking a member as moved out ("Auszug").
 *
 * On open it fetches the member's open balances and lists them as a warning.
 * Open balances warn but never block the move-out; moving out is reversible,
 * so it is not treated as destructive.
 */
export function MemberDeactivateDialog({
	encodedShareCode,
	member,
	viewerMemberId,
	selfLeave = false,
	onClose,
	onDeactivated,
}: MemberDeactivateDialogProps) {
	const t = useTranslations('shell.deactivate');
	const tCommon = useTranslations('common.errors');
	const tPerson = useTranslations('common');
	const tUi = useTranslations('shell.ui');
	const mode = selfLeave ? 'leave' : 'moveOut';
	const message = useMessage();
	const locale = useLocale() as Locale;
	// Copy that only varies by `mode` has no typed placeholders, so it goes through `Message`.
	const byMode = (
		key: 'adminRequired' | 'saveFailed' | 'loadFailed' | 'remain' | 'confirm',
	): string => message({ key: `shell.deactivate.${key}`, values: { mode } });
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [openBalances, setOpenBalances] = useState<OpenBalanceDto[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const submittingRef = useRef(false);

	// Load the open balances once per opened member.
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setLoadError(false);
		async function loadOpenBalances(): Promise<void> {
			const res = await apiFetch<OpenBalancesResponse>(
				`/api/wg/${encodedShareCode}/members/${member.id}`,
				{ memberId: viewerMemberId },
			);
			if (cancelled) return;
			if (res.ok) {
				setOpenBalances(res.data.openBalances);
			} else {
				setLoadError(true);
			}
			setLoading(false);
		}
		void loadOpenBalances();
		return () => {
			cancelled = true;
		};
	}, [encodedShareCode, member.id, viewerMemberId]);

	async function handleConfirm(): Promise<void> {
		if (submittingRef.current) return;
		submittingRef.current = true;
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
		if (res.error === 'admin_required') {
			setSubmitError(byMode('adminRequired'));
			submittingRef.current = false;
			setSubmitting(false);
			return;
		}
		setSubmitError(
			isRateLimited(res.error, res.status) ? tCommon('rateLimited') : byMode('saveFailed'),
		);
		submittingRef.current = false;
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
					<AlertDialogTitle>{t('title', { mode, name: member.name })}</AlertDialogTitle>
					<AlertDialogDescription>
						{t('description', { mode, name: member.name })}
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="grid gap-2">
					{loading ? (
						<p className="text-muted-foreground flex min-h-11 items-center gap-2 text-meta">
							<Spinner aria-hidden />
							{t('checking')}
						</p>
					) : loadError ? (
						<Alert>
							<AlertDescription>{byMode('loadFailed')}</AlertDescription>
						</Alert>
					) : openBalances.length === 0 ? (
						<p className="text-muted-foreground text-meta">{t('none')}</p>
					) : (
						<Alert>
							<AlertTitle>{byMode('remain')}</AlertTitle>
							<AlertDescription>
								<ul className="mt-1.5 grid gap-1">
									{openBalances.map((balance) => (
										<li
											key={`${balance.currency}-${balance.direction}-${balance.member_id}`}
											className="flex items-center justify-between gap-2 text-meta"
										>
											<span className="text-muted-foreground truncate">
												{t('balanceOwner', {
													direction: balance.direction,
													name: balance.name ?? tPerson('unknownPerson'),
												})}
											</span>
											<span className="text-foreground shrink-0 font-medium tabular-nums">
												{formatEuroCents(balance.amount_cents, balance.currency, { locale })}
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
					<AlertDialogCancel
						disabled={submitting}
						aria-label={selfLeave ? t('cancelLeaveLabel') : undefined}
					>
						{tUi('cancel')}
					</AlertDialogCancel>
					<Button
						variant="destructive"
						onClick={(event) => {
							event.preventDefault();
							void handleConfirm();
						}}
						disabled={submitting || loading}
						aria-label={selfLeave ? t('confirmLeaveLabel') : undefined}
					>
						{submitting && <Spinner aria-hidden />}
						{byMode('confirm')}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

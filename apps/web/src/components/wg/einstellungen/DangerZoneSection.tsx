'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { MemberDeactivateDialog } from '@/components/wg/MemberDeactivateDialog';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import { useWg } from '@/components/wg/WgContextProvider';
import { AccountDeleteSection } from '@/components/wg/einstellungen/AccountDeleteSection';
import { Section } from '@/components/wg/einstellungen/Section';
import { deleteWgErrorMessage, subjectError } from '@/components/wg/einstellungen/settings-errors';
import type { SessionMember } from '@/core/auth/local-account';
import { forgetWg } from '@/core/auth/local-account';
import { noteSessionExpiry, readApiErrorCode } from '@/core/infra/api-client';
import { useMessage } from '@/shared/i18n/message';
import { memberContextHeader } from '@/shared/lib/member-header';
import { LogOut, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

interface DangerZoneSectionProps {
	wg: WgSummary;
	members: Member[];
	identity: SessionMember;
}

/** Leave WG and delete WG. */
export function DangerZoneSection({ wg, members, identity }: DangerZoneSectionProps) {
	const t = useTranslations('settings.dangerZone');
	const actions = useTranslations('settings.actions');
	const m = useMessage();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const router = useRouter();
	const { isAdmin } = useWg();
	const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm' | 'pending'>('idle');
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [confirmText, setConfirmText] = useState('');
	const [leaving, setLeaving] = useState(false);
	// Focus the cancel button so iOS does not open the keyboard unprompted.
	const cancelRef = useRef<HTMLButtonElement>(null);
	const activeMemberCount = members.filter((m) => m.active).length;

	function leaveWg(outcome: 'left' | 'deleted' = 'left'): void {
		forgetWg(wg.shareCode);
		router.push(outcome === 'deleted' ? '/?deleted=1' : '/?left=1');
	}

	function openLeaveConfirm(): void {
		if (isAdmin || activeMemberCount <= 1) return;
		setLeaving(true);
		setDeleteStage('idle');
		setDeleteError(null);
		setConfirmText('');
	}

	function openDeleteConfirm(): void {
		if (!isAdmin) return;
		setLeaving(false);
		setDeleteStage('confirm');
		setDeleteError(null);
		setConfirmText('');
	}

	async function handleDelete(): Promise<void> {
		if (!isAdmin) return;
		setDeleteStage('pending');
		setDeleteError(null);
		try {
			const res = await fetch(`/api/wg/${encodedShareCode}`, {
				method: 'DELETE',
				headers: memberContextHeader(identity.memberId),
			});
			noteSessionExpiry(res);
			if (res.status === 403) {
				setDeleteError(t('adminOnlyDelete'));
				setDeleteStage('confirm');
				return;
			}
			if (!res.ok) {
				setDeleteError(m(deleteWgErrorMessage(res.status, (await readApiErrorCode(res)) || null)));
				setDeleteStage('confirm');
				return;
			}
			leaveWg('deleted');
		} catch {
			setDeleteError(
				m(subjectError('settings.dangerZone.errors.subject', 'common.errors.network')),
			);
			setDeleteStage('confirm');
		}
	}

	return (
		<>
			<div className="mt-3 grid gap-3 border-t pt-3">
				<h2 className="text-destructive text-xs font-medium">{t('title')}</h2>

				{isAdmin ? (
					<p className="text-muted-foreground text-xs">
						{activeMemberCount <= 1 ? t('adminLastMember') : t('adminHandover')}
					</p>
				) : (
					<Section title={t('leaveTitle')} hint={t('leaveHint')}>
						<div className="grid gap-3 p-3">
							{activeMemberCount <= 1 ? (
								<p className="text-muted-foreground text-xs">{t('leaveLastMember')}</p>
							) : (
								<Button
									type="button"
									variant="destructive"
									onClick={openLeaveConfirm}
									className="w-full"
								>
									<LogOut aria-hidden />
									{t('leaveTitle')}
								</Button>
							)}
						</div>
					</Section>
				)}

				<Section
					title={t('deleteTitle')}
					hint={isAdmin ? t('deleteHintAdmin') : t('adminOnlyDelete')}
				>
					<div className="p-3">
						<Button
							type="button"
							variant="destructive"
							onClick={openDeleteConfirm}
							disabled={!isAdmin}
							className="w-full"
						>
							<Trash2 aria-hidden />
							{t('deleteTrigger')}
						</Button>
					</div>
				</Section>

				<AccountDeleteSection />
			</div>

			<AlertDialog
				open={deleteStage !== 'idle'}
				onOpenChange={(open) => {
					if (!open && deleteStage !== 'pending') {
						setDeleteStage('idle');
						setDeleteError(null);
						setConfirmText('');
					}
				}}
			>
				<AlertDialogContent initialFocus={cancelRef}>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<Trash2 aria-hidden />
						</AlertDialogMedia>
						<AlertDialogTitle>{t('dialog.title')}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('dialog.body', { name: wg.name, code: wg.shareCode })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<Field>
						<FieldLabel htmlFor="delete-wg-confirm">{t('dialog.codeLabel')}</FieldLabel>
						<Input
							id="delete-wg-confirm"
							type="text"
							value={confirmText}
							onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
							placeholder={t('dialog.codePlaceholder')}
							disabled={deleteStage === 'pending'}
							className="text-center font-mono text-base tracking-[0.18em] placeholder:font-sans placeholder:tracking-normal"
							autoComplete="off"
						/>
					</Field>
					{deleteError && (
						<Alert variant="destructive">
							<AlertDescription>{deleteError}</AlertDescription>
						</Alert>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel ref={cancelRef} disabled={deleteStage === 'pending'}>
							{actions('cancel')}
						</AlertDialogCancel>
						<Button
							variant="destructive"
							onClick={(event) => {
								event.preventDefault();
								void handleDelete();
							}}
							disabled={deleteStage === 'pending' || confirmText !== wg.shareCode}
						>
							{deleteStage === 'pending' ? <Spinner aria-hidden /> : <Trash2 aria-hidden />}
							{t('dialog.confirm')}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{leaving && (
				<MemberDeactivateDialog
					encodedShareCode={encodedShareCode}
					member={{ id: identity.memberId, name: identity.name }}
					selfLeave
					viewerMemberId={identity.memberId}
					onClose={() => setLeaving(false)}
					onDeactivated={() => leaveWg()}
				/>
			)}
		</>
	);
}

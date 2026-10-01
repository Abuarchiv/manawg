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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { MemberDeactivateDialog } from '@/components/wg/MemberDeactivateDialog';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import { useWg } from '@/components/wg/WgContextProvider';
import { AccountDeleteSection } from '@/components/wg/einstellungen/AccountDeleteSection';
import { Section } from '@/components/wg/einstellungen/Section';
import { deleteWgErrorMessage, readResponseErrorCode } from '@/core/guards/settings-errors';
import type { StoredIdentity } from '@/shared/lib/identity';
import { clearIdentity, forgetWg, memberAuthHeader } from '@/shared/lib/identity';
import { LogOut, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface DangerZoneSectionProps {
	wg: WgSummary;
	members: Member[];
	identity: StoredIdentity;
}

/** WG verlassen, WG löschen und Konto löschen. */
export function DangerZoneSection({ wg, members, identity }: DangerZoneSectionProps) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const router = useRouter();
	const { isAdmin } = useWg();
	const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm' | 'pending'>('idle');
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [confirmText, setConfirmText] = useState('');
	const [leaving, setLeaving] = useState(false);
	const activeMemberCount = members.filter((m) => m.active).length;

	function leaveWg(): void {
		clearIdentity(wg.id);
		forgetWg(wg.shareCode);
		router.push('/');
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
				headers: memberAuthHeader(identity.memberId, identity.memberToken),
			});
			if (res.status === 403) {
				const errorCode = await readResponseErrorCode(res);
				setDeleteError(
					errorCode === 'member_not_verified'
						? 'Dein Gerät ist noch nicht bestätigt. Lade die App neu und versuche es erneut.'
						: 'Nur Admins können die WG löschen.',
				);
				setDeleteStage('confirm');
				return;
			}
			if (!res.ok) {
				setDeleteError(deleteWgErrorMessage(res.status, await readResponseErrorCode(res)));
				setDeleteStage('confirm');
				return;
			}
			leaveWg();
		} catch {
			setDeleteError(
				'WG konnte nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.',
			);
			setDeleteStage('confirm');
		}
	}

	return (
		<>
			<div className="grid gap-3">
				<div className="px-1">
					<h2 className="text-destructive text-[12px] font-semibold">Gefahrenzone</h2>
					<p className="text-muted-foreground mt-0.5 text-xs">
						WG verlassen, WG löschen oder Konto löschen.
					</p>
				</div>

				<Section
					title="WG verlassen"
					hint={
						isAdmin
							? 'Admin übergeben, dann verlassen.'
							: 'Deaktiviert deine Mitgliedschaft. Einträge und offene Salden bleiben erhalten.'
					}
				>
					<div className="grid gap-3 p-3">
						{isAdmin ? (
							<p className="text-muted-foreground text-[12px]">
								{activeMemberCount <= 1
									? 'Du bist Admin und das letzte aktive Mitglied. Aktiviere zuerst ein ausgezogenes Mitglied und übergib die Admin-Rolle, oder lösche die WG unten.'
									: 'Übergib zuerst die Admin-Rolle an ein aktives Mitglied (Button „Admin“ bei den Mitgliedern), danach kannst du die WG verlassen.'}
							</p>
						) : activeMemberCount <= 1 ? (
							<p className="text-muted-foreground text-[12px]">
								Du bist das letzte aktive Mitglied. Die WG kann erst verlassen werden, wenn ein
								weiteres Mitglied aktiv ist. Wenn du nur dieses Gerät abmelden möchtest, nutze oben
								„Konto abmelden“.
							</p>
						) : (
							<Button
								type="button"
								variant="destructive"
								onClick={openLeaveConfirm}
								className="w-full"
							>
								<LogOut aria-hidden />
								WG verlassen
							</Button>
						)}
					</div>
				</Section>

				<Section
					title="WG dauerhaft löschen"
					hint={
						isAdmin
							? 'Entfernt die gesamte WG und alle Daten (Ausgaben, Listen, Pinnwand) unwiderruflich für alle Mitglieder.'
							: 'Nur Admins können die WG löschen.'
					}
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
							Komplette WG für alle löschen
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
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<Trash2 aria-hidden />
						</AlertDialogMedia>
						<AlertDialogTitle>WG dauerhaft löschen?</AlertDialogTitle>
						<AlertDialogDescription>
							Diese Aktion löscht die WG {wg.name} für alle Mitglieder unwiderruflich. Tippe zur
							Bestätigung den WG-Code {wg.shareCode}.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<Field>
						<FieldLabel htmlFor="delete-wg-confirm">WG-Code zur Bestätigung</FieldLabel>
						<Input
							id="delete-wg-confirm"
							type="text"
							value={confirmText}
							onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
							placeholder={wg.shareCode}
							aria-describedby="delete-wg-confirm-hint"
							disabled={deleteStage === 'pending'}
							className="text-center font-mono text-base tracking-[0.18em]"
							autoComplete="off"
						/>
						<FieldDescription id="delete-wg-confirm-hint">
							Groß-/Kleinschreibung wird automatisch angeglichen.
						</FieldDescription>
					</Field>
					{deleteError && (
						<Alert variant="destructive">
							<AlertDescription>{deleteError}</AlertDescription>
						</Alert>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteStage === 'pending'}>Abbrechen</AlertDialogCancel>
						<Button
							variant="destructive"
							onClick={(event) => {
								event.preventDefault();
								void handleDelete();
							}}
							disabled={deleteStage === 'pending' || confirmText !== wg.shareCode}
						>
							{deleteStage === 'pending' ? <Spinner aria-hidden /> : <Trash2 aria-hidden />}
							Endgültig löschen
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
					viewerMemberToken={identity.memberToken}
					onClose={() => setLeaving(false)}
					onDeactivated={leaveWg}
				/>
			)}
		</>
	);
}

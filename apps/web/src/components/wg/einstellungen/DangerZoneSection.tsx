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
import {
	deleteWgErrorMessage,
	readResponseErrorCode,
} from '@/components/wg/einstellungen/settings-errors';
import { noteSessionExpiry } from '@/core/infra/api-client';
import type { StoredIdentity } from '@/shared/lib/identity';
import { clearIdentity, forgetWg, memberContextHeader } from '@/shared/lib/identity';
import { LogOut, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

interface DangerZoneSectionProps {
	wg: WgSummary;
	members: Member[];
	identity: StoredIdentity;
}

/** WG verlassen und WG löschen. */
export function DangerZoneSection({ wg, members, identity }: DangerZoneSectionProps) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const router = useRouter();
	const { isAdmin } = useWg();
	const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm' | 'pending'>('idle');
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [confirmText, setConfirmText] = useState('');
	const [leaving, setLeaving] = useState(false);
	// Fokus auf „Abbrechen“, damit auf iOS nicht ungefragt die Tastatur aufgeht.
	const cancelRef = useRef<HTMLButtonElement>(null);
	const activeMemberCount = members.filter((m) => m.active).length;

	function leaveWg(): void {
		clearIdentity(wg.id);
		forgetWg(wg.shareCode);
		router.push('/?left=1');
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
				setDeleteError('Nur Admins können die WG löschen.');
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
			<div className="mt-3 grid gap-3 border-t pt-3">
				<h2 className="text-destructive text-xs font-medium">Gefahrenzone</h2>

				{isAdmin ? (
					<p className="text-muted-foreground text-xs">
						{activeMemberCount <= 1
							? 'Du bist Admin und das letzte aktive Mitglied. Aktiviere zuerst ein ausgezogenes Mitglied und übergib die Admin-Rolle, oder lösche die WG unten.'
							: 'Übergib zuerst die Admin-Rolle an ein aktives Mitglied (Button „Admin übergeben“ bei den Mitgliedern), danach kannst du die WG verlassen.'}
					</p>
				) : (
					<Section
						title="WG verlassen"
						hint="Deaktiviert deine Mitgliedschaft. Einträge und offene Salden bleiben erhalten."
					>
						<div className="grid gap-3 p-3">
							{activeMemberCount <= 1 ? (
								<p className="text-muted-foreground text-xs">
									Du bist das letzte aktive Mitglied. Die WG kann erst verlassen werden, wenn ein
									weiteres Mitglied aktiv ist. Wenn du nur dieses Gerät abmelden möchtest, nutze
									oben „Konto abmelden“.
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
				)}

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
				<AlertDialogContent initialFocus={cancelRef}>
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
						<FieldLabel htmlFor="delete-wg-confirm">WG-Code</FieldLabel>
						<Input
							id="delete-wg-confirm"
							type="text"
							value={confirmText}
							onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
							placeholder="Code eingeben"
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
							Abbrechen
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
							WG löschen
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
					onDeactivated={leaveWg}
				/>
			)}
		</>
	);
}

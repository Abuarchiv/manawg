'use client';

import { Switch } from '@/components/animate-ui/components/base/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldTitle } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ShareWgCard } from '@/components/wg/ShareWgCard';
import type { WgSummary } from '@/components/wg/WgContextProvider';
import { useWg } from '@/components/wg/WgContextProvider';
import { Section } from '@/components/wg/einstellungen/Section';
import { accessErrorMessage } from '@/components/wg/einstellungen/settings-errors';
import { apiFetch } from '@/core/infra/api-client';
import type { StoredIdentity } from '@/shared/lib/identity';
import { forgetWg } from '@/shared/lib/identity';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

interface ShareAccessSectionProps {
	wg: WgSummary;
	identity: StoredIdentity;
	joiningEnabled: boolean;
	onJoiningEnabledChange: (enabled: boolean) => void;
}

/** WG-Code teilen sowie Beitritte sperren und den Code erneuern (nur Admins). */
export function ShareAccessSection({
	wg,
	identity,
	joiningEnabled,
	onJoiningEnabledChange: setJoiningEnabled,
}: ShareAccessSectionProps) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const router = useRouter();
	const { isAdmin } = useWg();
	const [accessPending, setAccessPending] = useState<'join' | 'rotate' | null>(null);
	const [accessMessage, setAccessMessage] = useState<string | null>(null);
	const [accessError, setAccessError] = useState<string | null>(null);
	const [rotateConfirm, setRotateConfirm] = useState(false);
	const accessPendingRef = useRef(false);

	async function updateAccess(body: {
		joiningEnabled?: boolean;
		rotateShareCode?: boolean;
	}): Promise<{ wg: WgSummary } | null> {
		if (!isAdmin) return null;
		setAccessError(null);
		setAccessMessage(null);
		const res = await apiFetch<{ wg: WgSummary }>(`/api/wg/${encodedShareCode}`, {
			method: 'PATCH',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify(body),
		});
		if (res.ok) return res.data;
		setAccessError(
			res.status === 403
				? res.error === 'member_not_verified'
					? 'Dein Gerät ist noch nicht bestätigt. Lade die App neu und versuche es erneut.'
					: 'Nur Admins können den WG-Zugang ändern.'
				: accessErrorMessage(res.status, res.error),
		);
		return null;
	}

	async function toggleJoining(): Promise<void> {
		if (!isAdmin || accessPendingRef.current) return;
		accessPendingRef.current = true;
		setAccessPending('join');
		setRotateConfirm(false);
		const next = !joiningEnabled;
		// Optimistisch umschalten, damit der Thumb sofort gleitet; bei Fehler zurück.
		setJoiningEnabled(next);
		try {
			const data = await updateAccess({ joiningEnabled: next });
			if (!data) {
				setJoiningEnabled(!next);
				return;
			}
			setJoiningEnabled(data.wg.joiningEnabled);
			setAccessMessage(
				next ? 'Neue Beitritte sind wieder erlaubt.' : 'Neue Beitritte sind gesperrt.',
			);
		} finally {
			accessPendingRef.current = false;
			setAccessPending(null);
		}
	}

	async function rotateShareCode(): Promise<void> {
		if (!isAdmin) return;
		if (!rotateConfirm) {
			setRotateConfirm(true);
			setAccessError(null);
			setAccessMessage('Klicke erneut auf Bestätigen, um den WG-Code zu erneuern.');
			return;
		}
		if (accessPendingRef.current) return;
		accessPendingRef.current = true;
		setAccessPending('rotate');
		try {
			const data = await updateAccess({ rotateShareCode: true });
			if (!data) return;
			setRotateConfirm(false);
			setJoiningEnabled(data.wg.joiningEnabled);
			// Old code is dead after rotation; drop it so the WG list doesn't show a stale duplicate.
			forgetWg(wg.shareCode);
			// #zugang, sonst landet man nach dem Erneuern wieder im Profil-Tab.
			router.replace(`/wg/${encodeURIComponent(data.wg.shareCode)}/einstellungen#zugang`);
		} finally {
			accessPendingRef.current = false;
			setAccessPending(null);
		}
	}

	function cancelRotateConfirm(): void {
		setRotateConfirm(false);
		setAccessError(null);
		setAccessMessage(null);
	}

	return (
		<>
			<Section
				title="WG teilen"
				hint={
					joiningEnabled
						? 'Code oder QR führen neue Mitbewohner zum Beitrittsflow.'
						: 'Beitritte sind gesperrt. Teilen wird blockiert, bis du den Zugang öffnest.'
				}
			>
				{/* ShareWgCard already centres QR and aligns copy buttons */}
				<div className="p-3">
					<ShareWgCard wgName={wg.name} shareCode={wg.shareCode} joiningEnabled={joiningEnabled} />
				</div>
			</Section>

			<Section
				title="Zugang"
				hint={
					isAdmin
						? 'Steuert, ob der aktuelle WG-Code neue Mitglieder aufnehmen darf.'
						: 'Nur Admins können den WG-Code verwalten.'
				}
			>
				<div className="grid gap-3 p-3">
					<Field orientation="horizontal" className="min-h-[44px]">
						<FieldContent className="min-w-0">
							<FieldTitle>Neue Beitritte</FieldTitle>
							<FieldDescription>
								{accessPending === 'join'
									? 'Wird gespeichert…'
									: joiningEnabled
										? 'Mit Code können neue Personen beitreten.'
										: 'Der Code ist für neue Beitritte gesperrt.'}
							</FieldDescription>
						</FieldContent>
						<Switch
							checked={joiningEnabled}
							disabled={!isAdmin || accessPending !== null}
							aria-busy={accessPending === 'join'}
							aria-label={joiningEnabled ? 'Neue Beitritte sperren' : 'Neue Beitritte erlauben'}
							onCheckedChange={() => void toggleJoining()}
						/>
					</Field>
					<div className="border-border border-t pt-2">
						<div className="flex min-h-[44px] flex-wrap items-center justify-between gap-3">
							<div className="min-w-0 flex-1 basis-40">
								<div className="text-foreground text-sm font-medium">WG-Code erneuern</div>
								<div className="text-muted-foreground mt-0.5 text-xs">
									Alte Links funktionieren danach nicht mehr.
								</div>
							</div>
							{rotateConfirm ? (
								<div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
									<Button
										type="button"
										variant="ghost"
										onClick={cancelRotateConfirm}
										disabled={accessPending !== null}
										aria-label="Abbrechen: WG-Code-Erneuerung"
										className="shrink-0 px-2.5"
									>
										Abbrechen
									</Button>
									<Button
										type="button"
										variant="destructive"
										onClick={() => void rotateShareCode()}
										disabled={!isAdmin || accessPending !== null}
										aria-label="Bestätigen: WG-Code-Erneuerung"
										className="shrink-0 px-2.5"
									>
										{accessPending === 'rotate' ? (
											<>
												<Spinner aria-hidden />
												Speichert…
											</>
										) : (
											'Bestätigen'
										)}
									</Button>
								</div>
							) : (
								<Button
									type="button"
									variant="outline"
									onClick={() => void rotateShareCode()}
									disabled={!isAdmin || accessPending !== null}
									aria-label="Erneuern: WG-Code"
									className="shrink-0"
								>
									Erneuern
								</Button>
							)}
						</div>
					</div>
					{accessMessage && (
						<Alert>
							<AlertDescription>{accessMessage}</AlertDescription>
						</Alert>
					)}
					{accessError && (
						<Alert variant="destructive">
							<AlertDescription>{accessError}</AlertDescription>
						</Alert>
					)}
				</div>
			</Section>
		</>
	);
}

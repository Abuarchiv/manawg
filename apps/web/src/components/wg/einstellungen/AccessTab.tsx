'use client';

import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { MemberDeactivateDialog } from '@/components/wg/MemberDeactivateDialog';
import { ShareWgCard } from '@/components/wg/ShareWgCard';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import { useWg } from '@/components/wg/WgContextProvider';
import { Section } from '@/components/wg/einstellungen/Section';
import {
	accessErrorMessage,
	deleteWgErrorMessage,
	readResponseErrorCode,
} from '@/core/guards/settings-errors';
import { apiFetch } from '@/core/infra/api-client';
import { buildSecurityOverview } from '@/core/infra/security';
import type { StoredIdentity } from '@/shared/lib/identity';
import { clearIdentity, forgetWg, memberAuthHeader } from '@/shared/lib/identity';
import { AlertTriangle, Loader2, LogOut, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

interface AccessTabProps {
	wg: WgSummary;
	members: Member[];
	identity: StoredIdentity;
}

export function AccessTab({ wg, members, identity }: AccessTabProps) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const router = useRouter();
	const { refreshMembers, isAdmin } = useWg();
	const [joiningEnabled, setJoiningEnabled] = useState(wg.joiningEnabled);
	const [accessPending, setAccessPending] = useState<'join' | 'rotate' | null>(null);
	const [accessMessage, setAccessMessage] = useState<string | null>(null);
	const [accessError, setAccessError] = useState<string | null>(null);
	const [rotateConfirm, setRotateConfirm] = useState(false);
	const [confirmLeave, setConfirmLeave] = useState(false);
	const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm' | 'pending'>('idle');
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [confirmText, setConfirmText] = useState('');
	const [memberToDeactivate, setMemberToDeactivate] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [reactivatingId, setReactivatingId] = useState<string | null>(null);
	const [memberActionMessage, setMemberActionMessage] = useState<string | null>(null);
	const [memberActionError, setMemberActionError] = useState<string | null>(null);
	const accessPendingRef = useRef(false);
	const activeMembers = members.filter((m) => m.active);
	const inactiveMembers = members.filter((m) => !m.active);

	function handleMemberDeactivated(name: string): void {
		setMemberActionError(null);
		setMemberActionMessage(`${name} ist jetzt als ausgezogen markiert.`);
		void refreshMembers(identity.memberId);
	}

	async function handleReactivate(member: { id: string; name: string }): Promise<void> {
		if (reactivatingId) return;
		setReactivatingId(member.id);
		setMemberActionError(null);
		setMemberActionMessage(null);
		const res = await apiFetch<{ member: { id: string; name: string; active: boolean } }>(
			`/api/wg/${encodedShareCode}/members/${member.id}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify({ active: true }),
			},
		);
		if (res.ok) {
			setMemberActionMessage(`${member.name} ist wieder aktiv.`);
			void refreshMembers(identity.memberId);
		} else {
			setMemberActionError('Aktivierung konnte nicht gespeichert werden. Bitte erneut versuchen.');
		}
		setReactivatingId(null);
	}
	const securityOverview = buildSecurityOverview({
		memberName: identity.name,
		memberCount: members.length,
		joiningEnabled,
		shareCodeRotatedAt: wg.shareCodeRotatedAt ?? null,
	});

	function handleLeave(): void {
		clearIdentity(wg.id);
		forgetWg(wg.shareCode);
		router.push('/');
	}

	function openLeaveConfirm(): void {
		setConfirmLeave(true);
		setDeleteStage('idle');
		setDeleteError(null);
		setConfirmText('');
	}

	function openDeleteConfirm(): void {
		setConfirmLeave(false);
		setDeleteStage('confirm');
		setDeleteError(null);
		setConfirmText('');
	}

	async function handleDelete(): Promise<void> {
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
						: 'Nur die erstellende Person kann die WG löschen.',
				);
				setDeleteStage('confirm');
				return;
			}
			if (!res.ok) {
				setDeleteError(deleteWgErrorMessage(res.status, await readResponseErrorCode(res)));
				setDeleteStage('confirm');
				return;
			}
			clearIdentity(wg.id);
			forgetWg(wg.shareCode);
			router.push('/');
		} catch {
			setDeleteError(
				'WG konnte nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.',
			);
			setDeleteStage('confirm');
		}
	}

	async function updateAccess(body: {
		joiningEnabled?: boolean;
		rotateShareCode?: boolean;
	}): Promise<{ wg: WgSummary } | null> {
		setAccessError(null);
		setAccessMessage(null);
		try {
			const res = await fetch(`/api/wg/${encodedShareCode}`, {
				method: 'PATCH',
				headers: {
					'content-type': 'application/json',
					...memberAuthHeader(identity.memberId, identity.memberToken),
				},
				body: JSON.stringify(body),
			});
			if (res.status === 403) {
				const errorCode = await readResponseErrorCode(res);
				setAccessError(
					errorCode === 'member_not_verified'
						? 'Dein Gerät ist noch nicht bestätigt. Lade die App neu und versuche es erneut.'
						: 'Nur die erstellende Person kann den WG-Zugang ändern.',
				);
				return null;
			}
			if (!res.ok) {
				setAccessError(accessErrorMessage(res.status, await readResponseErrorCode(res)));
				return null;
			}
			return (await res.json()) as { wg: WgSummary };
		} catch {
			setAccessError(
				'Zugang konnte nicht geändert werden: Prüfe deine Verbindung und versuche es erneut.',
			);
			return null;
		}
	}

	async function toggleJoining(): Promise<void> {
		if (accessPendingRef.current) return;
		accessPendingRef.current = true;
		setAccessPending('join');
		setRotateConfirm(false);
		const next = !joiningEnabled;
		try {
			const data = await updateAccess({ joiningEnabled: next });
			if (!data) return;
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
			router.replace(`/wg/${encodeURIComponent(data.wg.shareCode)}/einstellungen`);
		} finally {
			accessPendingRef.current = false;
			setAccessPending(null);
		}
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
				<div className="p-4">
					<ShareWgCard
						wgName={wg.name}
						shareCode={wg.shareCode}
						hideHeader
						joiningEnabled={joiningEnabled}
					/>
				</div>
			</Section>

			<Section
				title="Zugang"
				hint="Steuert, ob der aktuelle WG-Code neue Mitglieder aufnehmen darf."
			>
				<div className="space-y-3 p-4">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<div className="text-[14px] font-medium text-[var(--text-1)]">Neue Beitritte</div>
							<div className="mt-0.5 text-[12px] text-[var(--text-3)]">
								{joiningEnabled
									? 'Mit Code können neue Personen beitreten.'
									: 'Der Code ist für neue Beitritte gesperrt.'}
							</div>
						</div>
						<button
							type="button"
							onClick={() => void toggleJoining()}
							disabled={accessPending !== null}
							aria-label={joiningEnabled ? 'Neue Beitritte sperren' : 'Neue Beitritte erlauben'}
							aria-pressed={joiningEnabled}
							className={`inline-flex h-11 min-w-28 items-center justify-center rounded-md border px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
								joiningEnabled
									? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
									: 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
							}`}
						>
							{accessPending === 'join' ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
							) : joiningEnabled ? (
								'Erlaubt'
							) : (
								'Gesperrt'
							)}
						</button>
					</div>
					<div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
						<div className="flex items-center justify-between gap-3">
							<div className="min-w-0">
								<div className="text-[13.5px] font-medium text-[var(--text-1)]">
									WG-Code erneuern
								</div>
								<div className="mt-0.5 text-[12px] text-[var(--text-3)]">
									Alte Links funktionieren danach nicht mehr.
								</div>
							</div>
							<button
								type="button"
								onClick={() => void rotateShareCode()}
								disabled={accessPending !== null}
								aria-label={rotateConfirm ? 'WG-Code-Erneuerung bestätigen' : 'WG-Code erneuern'}
								className={`inline-flex h-11 min-w-24 items-center justify-center rounded-md px-3 text-[12.5px] font-medium transition disabled:opacity-50 ${
									rotateConfirm
										? 'bg-[var(--danger)] text-[var(--danger-fg)] hover:opacity-90'
										: 'border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--danger)] hover:text-[var(--danger)]'
								}`}
							>
								{accessPending === 'rotate' ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
								) : rotateConfirm ? (
									'Bestätigen'
								) : (
									'Erneuern'
								)}
							</button>
						</div>
					</div>
					{accessMessage && (
						<output className="block text-[12.5px] text-[var(--success-fg)]" aria-live="polite">
							{accessMessage}
						</output>
					)}
					{accessError && (
						<p role="alert" className="text-[12.5px] text-[var(--danger)]">
							{accessError}
						</p>
					)}
				</div>
			</Section>

			<Section
				title="Sicherheit & Vertrauen"
				hint="Schneller Überblick, wer drin ist und wie offen der WG-Code ist."
			>
				<div className="grid gap-2 p-3 sm:grid-cols-2">
					{securityOverview.map((item) => (
						<div key={item.label} className="rounded-md border border-[var(--border)] px-3 py-2">
							<p className="text-[11.5px] text-[var(--text-3)]">{item.label}</p>
							<p className="mt-0.5 text-[13px] font-medium text-[var(--text-1)]">{item.value}</p>
						</div>
					))}
				</div>
				<ul className="divide-y divide-[var(--border)] border-t border-[var(--border)] px-3">
					{activeMembers.map((member) => (
						<li key={member.id} className="flex items-center gap-2 py-2.5">
							<MemberAvatar name={member.name} color={member.color ?? null} size={26} />
							<span className="truncate text-[13px] text-[var(--text-1)]">{member.name}</span>
							{member.id === identity.memberId ? (
								<span className="ml-auto rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--text-3)]">
									dieses Gerät
								</span>
							) : (
								isAdmin && (
									<button
										type="button"
										onClick={() => setMemberToDeactivate({ id: member.id, name: member.name })}
										aria-label={`${member.name} ausziehen`}
										className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
									>
										<UserMinus className="h-3.5 w-3.5" aria-hidden />
										Ausziehen
									</button>
								)
							)}
						</li>
					))}
				</ul>
				{inactiveMembers.length > 0 && (
					<div className="border-t border-[var(--border)] px-3 pb-1 pt-2">
						<p className="px-0.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-3)]">
							Ausgezogen
						</p>
						<ul className="divide-y divide-[var(--border)]">
							{inactiveMembers.map((member) => (
								<li key={member.id} className="flex items-center gap-2 py-2.5 opacity-70">
									<MemberAvatar name={member.name} color={member.color ?? null} size={26} />
									<span className="truncate text-[13px] text-[var(--text-1)]">{member.name}</span>
									{isAdmin && (
										<button
											type="button"
											onClick={() => void handleReactivate({ id: member.id, name: member.name })}
											disabled={reactivatingId === member.id}
											aria-label={`${member.name} aktivieren`}
											className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
										>
											{reactivatingId === member.id ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
											) : (
												<UserPlus className="h-3.5 w-3.5" aria-hidden />
											)}
											Aktivieren
										</button>
									)}
								</li>
							))}
						</ul>
					</div>
				)}
				{memberActionMessage && (
					<output
						className="block border-t border-[var(--border)] px-4 py-2 text-[12.5px] text-[var(--success-fg)]"
						aria-live="polite"
					>
						{memberActionMessage}
					</output>
				)}
				{memberActionError && (
					<p
						role="alert"
						className="border-t border-[var(--border)] px-4 py-2 text-[12.5px] text-[var(--danger)]"
					>
						{memberActionError}
					</p>
				)}
			</Section>

			<div className="space-y-4">
				<div className="px-1">
					<h2 className="text-[13px] font-semibold text-[var(--danger)]">Gefahrenzone</h2>
					<p className="mt-0.5 text-[12px] text-[var(--text-3)]">
						Diese Aktionen sind teilweise oder vollständig unwiderruflich.
					</p>
				</div>

				{/* Leave WG */}
				<section
					aria-label="WG verlassen"
					className="overflow-hidden rounded-lg border border-[var(--danger)]/25 bg-[var(--bg-base)]"
				>
					<div className="border-b border-[var(--border)] bg-[var(--danger)]/[0.03] px-4 py-2.5">
						<h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--danger)]/70">
							WG verlassen
						</h3>
						<p className="mt-0.5 text-[11.5px] text-[var(--text-3)]">
							Entfernt dich nur auf diesem Gerät. Deine Einträge bleiben.
						</p>
					</div>
					{confirmLeave ? (
						<div className="space-y-3 p-4">
							<p className="text-[13px] text-[var(--text-2)]">
								Wirklich verlassen? Du musst dich beim nächsten Öffnen neu auswählen.
							</p>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => setConfirmLeave(false)}
									aria-label="WG-Verlassen abbrechen"
									className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[13px] text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
								>
									Abbrechen
								</button>
								<button
									type="button"
									onClick={handleLeave}
									aria-label="WG auf diesem Gerät verlassen"
									className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--danger)] text-[13px] font-medium text-[var(--danger-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2"
								>
									<LogOut className="h-3.5 w-3.5" aria-hidden />
									Verlassen
								</button>
							</div>
						</div>
					) : (
						<button
							type="button"
							onClick={openLeaveConfirm}
							className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--danger)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--danger)]"
						>
							<span className="text-[14px] text-[var(--danger)]">
								WG auf diesem Gerät verlassen
							</span>
							<LogOut className="h-4 w-4 shrink-0 text-[var(--danger)]" aria-hidden />
						</button>
					)}
				</section>

				{/* Delete WG */}
				<section
					aria-label="WG dauerhaft löschen"
					className="overflow-hidden rounded-lg border border-[var(--danger)]/25 bg-[var(--bg-base)]"
				>
					<div className="border-b border-[var(--border)] bg-[var(--danger)]/[0.03] px-4 py-2.5">
						<h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--danger)]/70">
							WG dauerhaft löschen
						</h3>
						<p className="mt-0.5 text-[11.5px] text-[var(--text-3)]">
							Entfernt die gesamte WG und alle Daten (Ausgaben, Listen, Pinnwand) unwiderruflich für
							alle Mitglieder.
						</p>
					</div>
					{deleteStage === 'idle' ? (
						<button
							type="button"
							onClick={openDeleteConfirm}
							className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--danger)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--danger)]"
						>
							<span className="text-[14px] text-[var(--danger)]">
								Komplette WG für alle löschen
							</span>
							<Trash2 className="h-4 w-4 shrink-0 text-[var(--danger)]" aria-hidden />
						</button>
					) : (
						<div className="space-y-3 p-4">
							<div className="flex items-start gap-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3 text-[12.5px] text-[var(--danger)]">
								<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
								<p id="delete-wg-confirm-hint">
									Diese Aktion löscht die WG <strong>{wg.name}</strong> für alle Mitglieder
									unwiderruflich. Tippe zur Bestätigung den WG-Code{' '}
									<span className="font-mono">{wg.shareCode}</span>.
								</p>
							</div>
							<input
								type="text"
								value={confirmText}
								onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
								placeholder={wg.shareCode}
								aria-describedby="delete-wg-confirm-hint"
								disabled={deleteStage === 'pending'}
								aria-label="WG-Code zur Bestätigung"
								className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-center font-mono text-[15px] tracking-[0.18em] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus-visible:border-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2"
							/>
							{deleteError && (
								<p role="alert" className="text-[12.5px] text-[var(--danger)]">
									{deleteError}
								</p>
							)}
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => {
										setDeleteStage('idle');
										setDeleteError(null);
										setConfirmText('');
									}}
									disabled={deleteStage === 'pending'}
									aria-label="WG-Löschung abbrechen"
									className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[13px] text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
								>
									Abbrechen
								</button>
								<button
									type="button"
									onClick={() => void handleDelete()}
									disabled={deleteStage === 'pending' || confirmText !== wg.shareCode}
									aria-label="WG endgültig löschen"
									className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--danger)] text-[13px] font-medium text-[var(--danger-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
								>
									{deleteStage === 'pending' ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
									) : (
										<Trash2 className="h-3.5 w-3.5" aria-hidden />
									)}
									Endgültig löschen
								</button>
							</div>
						</div>
					)}
				</section>
			</div>

			{memberToDeactivate && (
				<MemberDeactivateDialog
					encodedShareCode={encodedShareCode}
					member={memberToDeactivate}
					viewerMemberId={identity.memberId}
					onClose={() => setMemberToDeactivate(null)}
					onDeactivated={handleMemberDeactivated}
				/>
			)}
		</>
	);
}

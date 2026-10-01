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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { MemberDeactivateDialog } from '@/components/wg/MemberDeactivateDialog';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import { useWg } from '@/components/wg/WgContextProvider';
import { Section } from '@/components/wg/einstellungen/Section';
import { RATE_LIMITED_MESSAGE, isRateLimited } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { buildSecurityOverview } from '@/core/infra/security';
import type { StoredIdentity } from '@/shared/lib/identity';
import { Crown, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';

interface MembersSectionProps {
	wg: WgSummary;
	members: Member[];
	identity: StoredIdentity;
	joiningEnabled: boolean;
}

/** Mitgliederliste mit Admin-Übergabe, Ausziehen und Reaktivieren (nur Admins). */
export function MembersSection({ wg, members, identity, joiningEnabled }: MembersSectionProps) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const { refreshMembers, isAdmin } = useWg();
	const [memberToDeactivate, setMemberToDeactivate] = useState<{ id: string; name: string } | null>(
		null,
	);
	const [memberToPromote, setMemberToPromote] = useState<{ id: string; name: string } | null>(null);
	const [promoting, setPromoting] = useState(false);
	const [promoteError, setPromoteError] = useState<string | null>(null);
	const [reactivatingId, setReactivatingId] = useState<string | null>(null);
	const [memberActionMessage, setMemberActionMessage] = useState<string | null>(null);
	const [memberActionError, setMemberActionError] = useState<string | null>(null);
	const activeMembers = members.filter((m) => m.active);
	const inactiveMembers = members.filter((m) => !m.active);

	function handleMemberDeactivated(name: string): void {
		setMemberActionError(null);
		setMemberActionMessage(`${name} ist jetzt als ausgezogen markiert.`);
		void refreshMembers(identity.memberId);
	}

	async function handleTransferAdmin(): Promise<void> {
		if (!memberToPromote || promoting) return;
		setPromoting(true);
		setPromoteError(null);
		const res = await apiFetch<{ member: { id: string; name: string } }>(
			`/api/wg/${encodedShareCode}/members/${memberToPromote.id}/admin`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({}),
			},
		);
		setPromoting(false);
		if (!res.ok) {
			setPromoteError(
				isRateLimited(res.error, res.status)
					? RATE_LIMITED_MESSAGE
					: res.error === 'member_inactive'
						? 'Dieses Mitglied ist ausgezogen. Aktiviere es zuerst wieder.'
						: res.error === 'member_not_linked'
							? 'Dieses Mitglied hat noch kein Konto verknüpft und kann nicht Admin werden.'
							: 'Admin-Rolle konnte nicht übergeben werden. Bitte erneut versuchen.',
			);
			return;
		}
		setMemberActionError(null);
		setMemberActionMessage(
			`${memberToPromote.name} ist jetzt Admin. Du kannst die WG jetzt normal verlassen.`,
		);
		setMemberToPromote(null);
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
				memberToken: identity.memberToken,
				body: JSON.stringify({ active: true }),
			},
		);
		if (res.ok) {
			setMemberActionMessage(`${member.name} ist wieder aktiv.`);
			void refreshMembers(identity.memberId);
		} else {
			setMemberActionError(
				isRateLimited(res.error, res.status)
					? RATE_LIMITED_MESSAGE
					: 'Aktivierung konnte nicht gespeichert werden. Bitte erneut versuchen.',
			);
		}
		setReactivatingId(null);
	}

	const securityOverview = buildSecurityOverview({
		memberName: identity.name,
		// Ausgezogene zählen nicht mit, sonst widerspricht die Zahl der Liste darunter.
		memberCount: activeMembers.length,
		joiningEnabled,
		shareCodeRotatedAt: wg.shareCodeRotatedAt ?? null,
	});

	return (
		<>
			<Section
				title="Mitglieder & Sicherheit"
				hint="Wer drin ist, wie offen der WG-Code ist und wer ausziehen kann."
			>
				<div className="grid grid-cols-2 gap-3 p-3">
					{securityOverview.map((item) => (
						<div key={item.label} className="min-w-0">
							<p className="text-muted-foreground text-xs">{item.label}</p>
							<p className="text-foreground mt-0.5 break-words text-[12px] font-medium">
								{item.value}
							</p>
						</div>
					))}
				</div>
				<Separator />
				<ItemGroup className="gap-0 px-2 py-1">
					{activeMembers.map((member) => (
						<Item key={member.id} size="sm" className="min-h-[44px] flex-wrap">
							<ItemMedia>
								<MemberAvatar name={member.name} size={26} />
							</ItemMedia>
							<ItemContent className="min-w-0 basis-20">
								<ItemTitle className="line-clamp-none">{member.name}</ItemTitle>
							</ItemContent>
							<ItemActions>
								{member.id === identity.memberId ? (
									<Badge variant="secondary">Du</Badge>
								) : (
									isAdmin && (
										<>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => {
													setPromoteError(null);
													setMemberToPromote({ id: member.id, name: member.name });
												}}
												aria-label={`Admin übergeben: ${member.name}`}
											>
												<Crown aria-hidden />
												Admin
											</Button>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => setMemberToDeactivate({ id: member.id, name: member.name })}
												aria-label={`Ausziehen: ${member.name}`}
											>
												<UserMinus aria-hidden />
												Ausziehen
											</Button>
										</>
									)
								)}
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
				{inactiveMembers.length > 0 && (
					<div className="px-4 pt-2 pb-1">
						<p className="text-muted-foreground px-0.5 pb-1 text-xs font-medium tracking-wide uppercase">
							Ausgezogen
						</p>
						<ItemGroup className="gap-0">
							{inactiveMembers.map((member) => (
								<Item key={member.id} size="sm" className="min-h-[44px] flex-wrap opacity-70">
									<ItemMedia>
										<MemberAvatar name={member.name} size={26} />
									</ItemMedia>
									<ItemContent className="min-w-0 basis-40">
										<ItemTitle className="line-clamp-none">{member.name}</ItemTitle>
										<ItemDescription className="line-clamp-none">
											Ausgezogen, Verlauf bleibt erhalten
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										{isAdmin && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => void handleReactivate({ id: member.id, name: member.name })}
												disabled={reactivatingId === member.id}
												aria-label={`Aktivieren: ${member.name}`}
											>
												{reactivatingId === member.id ? (
													<Spinner aria-hidden />
												) : (
													<UserPlus aria-hidden />
												)}
												Aktivieren
											</Button>
										)}
									</ItemActions>
								</Item>
							))}
						</ItemGroup>
					</div>
				)}
				{memberActionMessage && (
					<div className="px-4 pb-3">
						<Alert>
							<AlertDescription>{memberActionMessage}</AlertDescription>
						</Alert>
					</div>
				)}
				{memberActionError && (
					<div className="px-4 pb-3">
						<Alert variant="destructive">
							<AlertDescription>{memberActionError}</AlertDescription>
						</Alert>
					</div>
				)}
			</Section>

			<AlertDialog
				open={memberToPromote !== null}
				onOpenChange={(open) => {
					if (!open && !promoting) setMemberToPromote(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<Crown aria-hidden />
						</AlertDialogMedia>
						<AlertDialogTitle>Admin-Rolle übergeben?</AlertDialogTitle>
						<AlertDialogDescription>
							{memberToPromote?.name} wird Admin dieser WG. Du wirst normales Mitglied und kannst
							die Rolle nur zurückbekommen, wenn {memberToPromote?.name} sie dir übergibt.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{promoteError && (
						<Alert variant="destructive">
							<AlertDescription>{promoteError}</AlertDescription>
						</Alert>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={promoting}>Abbrechen</AlertDialogCancel>
						<Button
							onClick={(event) => {
								event.preventDefault();
								void handleTransferAdmin();
							}}
							disabled={promoting}
						>
							{promoting && <Spinner aria-hidden />}
							Übergeben
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{memberToDeactivate && (
				<MemberDeactivateDialog
					encodedShareCode={encodedShareCode}
					member={memberToDeactivate}
					viewerMemberId={identity.memberId}
					viewerMemberToken={identity.memberToken}
					onClose={() => setMemberToDeactivate(null)}
					onDeactivated={handleMemberDeactivated}
				/>
			)}
		</>
	);
}

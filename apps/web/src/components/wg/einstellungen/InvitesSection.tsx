'use client';

import { useToast } from '@/components/ui/Toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { InviteByMailForm } from '@/components/wg/InviteByMailForm';
import type { WgSummary } from '@/components/wg/WgContextProvider';
import { Section } from '@/components/wg/einstellungen/Section';
import { createInvite, shareInvite } from '@/components/wg/invite-share';
import type { SessionMember } from '@/core/auth/local-account';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { apiFetch } from '@/core/infra/api-client';
import { copyText } from '@/core/utils/clipboard';
import { INVITE_VALID_DAYS } from '@/core/utils/invite-token';
import { Copy, Plus, Share2 } from 'lucide-react';
import { useRef, useState } from 'react';
import QRCode from 'react-qr-code';

interface InviteListItem {
	id: string;
	expiresAt: string;
	maxUses: number;
	useCount: number;
	createdByName: string | null;
}

function expiryLabel(expiresAt: string): string {
	const date = new Date(expiresAt).toLocaleDateString('de-DE', {
		day: 'numeric',
		month: 'short',
		timeZone: 'Europe/Berlin',
	});
	return `läuft am ${date} ab`;
}

/** Invitation links of the WG: create and share one, see the active ones, revoke them. */
export function InvitesSection({ wg, identity }: { wg: WgSummary; identity: SessionMember }) {
	const toast = useToast();
	const encodedCode = encodeURIComponent(wg.shareCode);
	const listUrl = `/api/wg/${encodedCode}/invites`;
	const {
		data,
		error: loadError,
		refresh,
	} = useCachedFetch<{ invites: InviteListItem[] }>(listUrl, { memberId: identity.memberId });
	const [creating, setCreating] = useState(false);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [fresh, setFresh] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const busyRef = useRef(false);

	async function create(): Promise<void> {
		if (busyRef.current) return;
		busyRef.current = true;
		setCreating(true);
		setError(null);
		setMessage(null);
		try {
			const result = await createInvite(wg.shareCode, identity.memberId);
			if (!result.ok) {
				setError(result.message);
				return;
			}
			setFresh(result.invite.url);
			void refresh({ afterMutation: true });
		} finally {
			busyRef.current = false;
			setCreating(false);
		}
	}

	async function share(url: string): Promise<void> {
		const outcome = await shareInvite(wg.name, url);
		if (outcome === 'copied') toast.success('Einladung kopiert.');
		if (outcome === 'failed') toast.error('Teilen fehlgeschlagen. Kopiere den Link stattdessen.');
	}

	async function copy(url: string): Promise<void> {
		if (await copyText(url)) toast.success('Link kopiert.');
		else toast.error('Kopieren fehlgeschlagen. Markiere den Link und kopiere ihn manuell.');
	}

	async function revoke(id: string): Promise<void> {
		if (busyRef.current) return;
		busyRef.current = true;
		setRevokingId(id);
		setError(null);
		setMessage(null);
		try {
			const res = await apiFetch<{ revoked: true }>(`${listUrl}/${encodeURIComponent(id)}`, {
				method: 'DELETE',
				memberId: identity.memberId,
			});
			if (!res.ok && res.status !== 404) {
				setError('Die Einladung konnte nicht widerrufen werden. Versuch es noch mal.');
				return;
			}
			setMessage('Einladung widerrufen.');
			setFresh(null);
			void refresh({ afterMutation: true });
		} finally {
			busyRef.current = false;
			setRevokingId(null);
		}
	}

	const invites = data?.invites ?? [];

	return (
		<>
			<Section
				id="einladungen"
				title="Einladungen"
				hint={`Wer einen Link hat, kann beitreten. Jeder Link gilt ${INVITE_VALID_DAYS} Tage.`}
			>
				{/* minmax(0,1fr): sonst weitet ein nicht umbrechender Knopf bei 200 % Text die ganze Karte. */}
				<div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3">
					<Button
						type="button"
						onClick={() => void create()}
						disabled={creating || revokingId !== null}
						aria-busy={creating}
						className="h-auto min-h-11 w-full whitespace-normal"
					>
						{creating ? <Spinner aria-hidden /> : <Plus aria-hidden />}
						Neue Einladung
					</Button>
					{fresh && (
						<div className="grid gap-2 rounded-lg border border-border p-3">
							<p className="text-muted-foreground text-xs">Neuer Einladungslink</p>
							<div
								role="img"
								aria-label="QR-Code des Einladungslinks"
								className="mx-auto w-fit rounded-lg bg-white p-3"
							>
								<QRCode value={fresh} size={148} level="M" />
							</div>
							<p className="text-foreground break-all text-sm">{fresh}</p>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									className="flex-1"
									onClick={() => void share(fresh)}
								>
									<Share2 aria-hidden />
									Teilen
								</Button>
								<Button
									type="button"
									variant="outline"
									className="flex-1"
									aria-label="Einladungslink kopieren"
									onClick={() => void copy(fresh)}
								>
									<Copy aria-hidden />
									Kopieren
								</Button>
							</div>
						</div>
					)}
					{message && (
						<Alert>
							<AlertDescription>{message}</AlertDescription>
						</Alert>
					)}
					{(error || loadError) && (
						<Alert variant="destructive">
							<AlertDescription>
								{error ?? 'Die Einladungen konnten nicht geladen werden.'}
							</AlertDescription>
						</Alert>
					)}
					<ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label="Aktive Einladungen">
						{invites.map((invite) => (
							<li
								key={invite.id}
								className="flex min-h-[44px] flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
							>
								<div className="min-w-0">
									<p className="text-foreground text-sm font-medium">
										Von {invite.createdByName ?? 'ehemaligem Mitglied'}
									</p>
									<p className="text-muted-foreground text-xs">
										{expiryLabel(invite.expiresAt)} · {invite.useCount} von {invite.maxUses} genutzt
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									className="shrink-0"
									disabled={creating || revokingId !== null}
									aria-label={`Einladung von ${invite.createdByName ?? 'ehemaligem Mitglied'} widerrufen`}
									onClick={() => void revoke(invite.id)}
								>
									{revokingId === invite.id && <Spinner aria-hidden />}
									Widerrufen
								</Button>
							</li>
						))}
					</ul>
					{data && invites.length === 0 && (
						<p className="text-muted-foreground text-sm">Keine aktiven Einladungen.</p>
					)}
					<InviteByMailForm shareCode={wg.shareCode} memberId={identity.memberId} />
				</div>
			</Section>

			<Section title="Adresse der WG">
				<div className="p-3">
					<p className="text-foreground font-mono text-base font-medium tracking-[0.05em]">
						{wg.shareCode}
					</p>
					<p className="text-muted-foreground mt-1 text-xs">
						Der Code ist nur die Adresse der WG in der App. Zum Beitritt braucht es eine Einladung.
					</p>
				</div>
			</Section>
		</>
	);
}

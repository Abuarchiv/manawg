'use client';

import { type StoredIdentity, clearIdentity, memberAuthHeader } from '@/shared/lib/identity';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

interface Member {
	id: string;
	name: string;
	color?: string | null;
	active?: boolean;
}

interface Props {
	wgId: string;
	wgShareCode: string;
	wgName: string;
	members: Member[];
	legacyIdentity?: StoredIdentity | null;
	onPicked: (identity: StoredIdentity) => void;
}

const NAME_MAX = 80;

async function readCreateMemberError(response: Response): Promise<string> {
	try {
		const body = (await response.clone().json()) as { error?: unknown; code?: unknown };
		if (typeof body.error === 'string') return body.error;
		if (typeof body.code === 'string') return body.code;
	} catch {
		return '';
	}
	return '';
}

function createMemberErrorMessage(status: number, error: string): string {
	if (
		status >= 500 ||
		error === 'unexpected_error' ||
		error === 'server_error' ||
		error === 'db_error'
	) {
		return 'Beitritt konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (status === 404 || error === 'wg_not_found') {
		return 'Diese WG wurde nicht gefunden. Öffne sie über den aktuellen WG-Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Der WG-Code ist ungültig. Öffne die WG über einen gültigen Link.';
	}
	if (error === 'name_invalid' || error === 'invalid_json') {
		return 'Name muss 1–80 Zeichen lang sein.';
	}
	return 'Konnte Mitglied nicht anlegen.';
}

export function IdentityPicker({
	wgId,
	wgShareCode,
	wgName,
	members,
	legacyIdentity = null,
	onPicked,
}: Props) {
	const router = useRouter();
	const [newName, setNewName] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submittingRef = useRef(false);
	const legacyMember = legacyIdentity?.memberToken
		? members.find((member) => member.id === legacyIdentity.memberId && member.active !== false)
		: undefined;

	function returnToSignIn(): void {
		const currentPath = `${window.location.pathname}${window.location.search}`;
		router.replace(`/neu?next=${encodeURIComponent(currentPath)}`);
	}

	async function selectExisting(member: Member): Promise<void> {
		if (submittingRef.current) return;
		if (!legacyIdentity?.memberToken || legacyIdentity.memberId !== member.id) return;
		submittingRef.current = true;
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch(
				`/api/wg/${encodeURIComponent(wgShareCode)}/members/${encodeURIComponent(member.id)}/claim`,
				{
					method: 'POST',
					headers: memberAuthHeader(legacyIdentity.memberId, legacyIdentity.memberToken),
				},
			);
			if (!res.ok) {
				const apiError = await readCreateMemberError(res);
				if (res.status === 401 && apiError === 'auth_required') {
					returnToSignIn();
					return;
				}
				setError(
					'Dieses Profil konnte nicht übernommen werden. Prüfe, ob du auf dem alten Gerät angemeldet bist.',
				);
				return;
			}
			const data = (await res.json()) as { member: { id: string; name: string } };
			clearIdentity(wgId);
			onPicked({ memberId: data.member.id, name: data.member.name });
		} catch {
			setError(
				'Profil konnte nicht übernommen werden. Prüfe deine Verbindung und versuche es erneut.',
			);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	}

	async function createNew(): Promise<void> {
		if (submittingRef.current) return;
		const trimmed = newName.trim();
		if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
			setError('Name muss 1–80 Zeichen lang sein.');
			return;
		}
		submittingRef.current = true;
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch(`/api/wg/${encodeURIComponent(wgShareCode)}/members`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: trimmed }),
			});
			if (res.status === 401 && (await readCreateMemberError(res)) === 'auth_required') {
				returnToSignIn();
				return;
			}
			if (res.status === 409) {
				const apiError = await readCreateMemberError(res);
				setError(
					apiError === 'member_limit_reached'
						? 'Diese WG ist voll. Bitte wende dich an die WG-Verwaltung.'
						: 'Name in dieser WG bereits vergeben.',
				);
				return;
			}
			if (res.status === 403) {
				const apiError = await readCreateMemberError(res);
				setError(
					apiError === 'joining_disabled'
						? 'Diese WG nimmt gerade keine neuen Beitritte an.'
						: 'Du kannst dieser WG gerade nicht beitreten.',
				);
				return;
			}
			if (!res.ok) {
				setError(createMemberErrorMessage(res.status, await readCreateMemberError(res)));
				return;
			}
			const data = (await res.json()) as { member: Member & { token?: string | null } };
			const identity: StoredIdentity = {
				memberId: data.member.id,
				name: data.member.name,
			};
			onPicked(identity);
		} catch {
			setError(
				'Beitritt konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
			);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	}

	return (
		<main
			id="main"
			tabIndex={-1}
			className="flex min-h-svh items-center justify-center bg-[var(--bg-base)] px-4 py-10 focus:outline-none"
		>
			<div className="w-full max-w-sm">
				<header className="mb-7 text-center">
					<p className="text-[11.5px] font-medium uppercase tracking-[0.18em] text-[var(--text-3)]">
						{wgShareCode}
					</p>
					<h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						{wgName}
					</h1>
					<p className="mt-2 text-sm text-[var(--text-2)]">Lege deinen Anzeigenamen an</p>
				</header>

				{error && (
					<p
						role="alert"
						className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]"
					>
						{error}
					</p>
				)}

				{legacyMember && (
					<div className="mb-5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3">
						<p className="text-[13px] text-[var(--text-2)]">
							Dein altes, signiertes Profil wurde gefunden.
						</p>
						<button
							type="button"
							onClick={() => void selectExisting(legacyMember)}
							disabled={submitting}
							className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[var(--accent)]/40 px-3 py-2 text-[14px] font-medium text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
							Bestehendes Profil „{legacyMember.name}“ übernehmen
						</button>
					</div>
				)}

				<form
					onSubmit={(e) => {
						e.preventDefault();
						void createNew();
					}}
					className="space-y-4"
				>
					<div>
						<label
							htmlFor="ident-name"
							className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
						>
							Dein Anzeigename
						</label>
						<input
							id="ident-name"
							type="text"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							maxLength={NAME_MAX}
							placeholder="z. B. Anna"
							autoComplete="name"
							disabled={submitting}
							className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[15px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
						/>
						<p className="mt-1.5 text-[12px] text-[var(--text-3)]">
							So sehen dich deine Mitbewohner:innen.
						</p>
					</div>

					<div className="flex items-center gap-2">
						<button
							type="submit"
							disabled={submitting || newName.trim().length === 0}
							className="ml-auto inline-flex h-11 items-center gap-2 rounded-md bg-[var(--text-1)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
						>
							{submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
							WG betreten
						</button>
					</div>
				</form>

				<p className="mt-8 text-center text-[12px] text-[var(--text-3)]">
					Deine WG-Daten sind an dein Konto gebunden, nicht an dieses Gerät.
				</p>
			</div>
		</main>
	);
}

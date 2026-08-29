'use client';

import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { type StoredIdentity, setIdentity } from '@manawg/shared/lib/identity';
import { ArrowLeft, Loader2, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';

interface Member {
	id: string;
	name: string;
	color?: string | null;
}

interface Props {
	wgId: string;
	wgShareCode: string;
	wgName: string;
	members: Member[];
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

export function IdentityPicker({ wgId, wgShareCode, wgName, members, onPicked }: Props) {
	const [mode, setMode] = useState<'pick' | 'new'>(members.length > 0 ? 'pick' : 'new');
	const [newName, setNewName] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submittingRef = useRef(false);

	function persistIdentity(identity: StoredIdentity): boolean {
		try {
			setIdentity(wgId, identity);
			return true;
		} catch {
			setError(
				'Profil konnte auf diesem Gerät nicht gespeichert werden. Prüfe den Browser-Speicher und versuche es erneut.',
			);
			return false;
		}
	}

	function selectExisting(member: Member): void {
		const identity: StoredIdentity = { memberId: member.id, name: member.name };
		setError(null);
		if (!persistIdentity(identity)) return;
		onPicked(identity);
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
			if (res.status === 409) {
				const apiError = await readCreateMemberError(res);
				setError(
					apiError === 'member_limit_reached'
						? 'Diese WG ist voll. Bitte eine bestehende Person auswählen oder die WG aufräumen.'
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
				...(data.member.token ? { memberToken: data.member.token } : {}),
			};
			if (!persistIdentity(identity)) return;
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
		<div className="flex min-h-svh items-center justify-center bg-[var(--bg-base)] px-4 py-10">
			<div className="w-full max-w-sm">
				<header className="mb-7 text-center">
					<p className="text-[11.5px] font-medium uppercase tracking-[0.18em] text-[var(--text-3)]">
						{wgShareCode}
					</p>
					<h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						{wgName}
					</h1>
					<p className="mt-2 text-sm text-[var(--text-2)]">
						{mode === 'pick' ? 'Wähle dein Profil' : 'Lege dein Profil an'}
					</p>
				</header>

				{error && (
					<p
						role="alert"
						className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]"
					>
						{error}
					</p>
				)}

				{mode === 'pick' && members.length > 0 && (
					<div className="space-y-2">
						<ul className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]">
							{members.map((m, i) => (
								<li key={m.id} className={i > 0 ? 'border-t border-[var(--border)]' : ''}>
									<button
										type="button"
										onClick={() => selectExisting(m)}
										className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
									>
										<MemberAvatar name={m.name} color={m.color ?? null} size={32} />
										<span className="flex-1 truncate text-[15px] font-medium text-[var(--text-1)]">
											{m.name}
										</span>
										<span className="text-[13px] text-[var(--text-3)]" aria-hidden="true">
											→
										</span>
									</button>
								</li>
							))}
						</ul>
						<button
							type="button"
							onClick={() => setMode('new')}
							className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-[14px] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							<UserPlus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
							Ich bin neu hier
						</button>
					</div>
				)}

				{mode === 'new' && (
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
								Dein Name
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
							{members.length > 0 && (
								<button
									type="button"
									onClick={() => {
										setMode('pick');
										setError(null);
									}}
									disabled={submitting}
									className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-[13px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Zurück
								</button>
							)}
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
				)}

				<p className="mt-8 text-center text-[12px] text-[var(--text-3)]">
					Kein Login. Daten bleiben lokal an dieses Gerät gebunden.
				</p>
			</div>
		</div>
	);
}

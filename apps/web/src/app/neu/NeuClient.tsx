'use client';

import { BackButton } from '@/components/neu/BackButton';
import { ErrorBox } from '@/components/neu/ErrorBox';
import { Field } from '@/components/neu/Field';
import { InviteStep } from '@/components/neu/InviteStep';
import { getInitialJoinCode, joinErrorMessage, shouldFallbackToDirectJoin } from '@/lib/join-flow';
import { readDraft, removeDraft, writeDraft } from '@/lib/wg/drafts';
import { LogoMark } from '@manawg/shared/components/ui/LogoMark';
import {
	type KnownWg,
	getIdentity,
	getKnownWgs,
	rememberWg,
	setIdentity,
} from '@manawg/shared/lib/identity';
import { isValidShareCode, normalizeShareCode } from '@manawg/shared/lib/share-code';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const WG_NAME_MAX = 100;
const NAME_MAX = 80;
const START_DRAFT_KEY = 'manawg:draft:neu';

interface CreateResponse {
	wg: { id: string; shareCode: string; name: string };
	creator: { id: string; name: string; token?: string | null };
}

interface WgResponse {
	wg: { id: string; shareCode: string; name: string; joiningEnabled?: boolean };
}

interface MemberResponse {
	member: { id: string; name: string; token?: string | null };
}

interface CreatedWg {
	code: string;
	name: string;
}

interface JoinWg {
	id: string;
	code: string;
	name: string;
}

type StartStep = 'choose' | 'create' | 'join' | 'joinName' | 'invite';

interface StartDraft extends Record<string, unknown> {
	step?: StartStep;
	wgName?: string;
	creatorName?: string;
	joinCode?: string;
	joinName?: string;
	joinWg?: JoinWg;
}

async function readStartError(response: Response): Promise<string> {
	try {
		const body = (await response.clone().json()) as { code?: unknown; error?: unknown };
		if (typeof body.error === 'string') return body.error;
		if (typeof body.code === 'string') return body.code;
	} catch {
		return '';
	}
	return '';
}

function createWgErrorMessage(status: number, error: string): string {
	if (status === 400 && error === 'name_invalid') {
		return 'WG konnte nicht erstellt werden: Der WG-Name muss 1 bis 100 Zeichen haben.';
	}
	if (status === 400 && error === 'creator_name_invalid') {
		return 'WG konnte nicht erstellt werden: Dein Name muss 1 bis 80 Zeichen haben.';
	}
	if (status === 400 && (error === 'invalid_body' || error === 'invalid_json')) {
		return 'WG-Name und dein Name müssen ausgefüllt und kurz genug sein.';
	}
	if (error === 'share_code_exhausted') {
		return 'Gerade konnte kein WG-Code erstellt werden. Bitte versuche es gleich noch einmal.';
	}
	if (error === 'insert_failed' || error === 'member_insert_failed') {
		return 'WG konnte nicht vollständig erstellt werden. Bitte versuche es erneut.';
	}
	if (
		status >= 500 ||
		error === 'server_error' ||
		error === 'unexpected_error' ||
		error === 'db_error'
	) {
		return 'WG konnte nicht erstellt werden: Versuche es gleich erneut.';
	}
	return 'Konnte WG nicht erstellen.';
}

function identityStorageErrorMessage(code: string): string {
	return `WG wurde erstellt, aber dein Profil konnte auf diesem Gerät nicht gespeichert werden. Sichere den WG-Code ${code} und tritt damit erneut bei.`;
}

function joinIdentityStorageErrorMessage(code: string, name: string): string {
	return `${name} wurde in der WG angelegt, aber dein Profil konnte auf diesem Gerät nicht gespeichert werden. Öffne die WG mit Code ${code} und wähle dein Profil aus.`;
}

function isJoinWg(value: unknown): value is JoinWg {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return (
		typeof Reflect.get(value, 'id') === 'string' &&
		typeof Reflect.get(value, 'code') === 'string' &&
		typeof Reflect.get(value, 'name') === 'string'
	);
}

export function NeuClient() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [step, setStep] = useState<StartStep>('choose');
	const [wgName, setWgName] = useState('');
	const [creatorName, setCreatorName] = useState('');
	const [joinCode, setJoinCode] = useState('');
	const [joinName, setJoinName] = useState('');
	const [joinWg, setJoinWg] = useState<JoinWg | null>(null);
	const [knownWgs, setKnownWgs] = useState<KnownWg[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createdWg, setCreatedWg] = useState<CreatedWg | null>(null);
	const [inviteWarning, setInviteWarning] = useState<string | null>(null);
	const [interactive, setInteractive] = useState(false);
	const busyRef = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initializer — reads the saved draft and initial URL params once; adding searchParams would re-run on navigation and clobber in-progress step/draft state.
	useEffect(() => {
		setKnownWgs(getKnownWgs());
		const code = typeof window === 'undefined' ? '' : getInitialJoinCode(window.location.search);
		const draft = readDraft<StartDraft>(START_DRAFT_KEY);
		if (draft?.wgName) setWgName(draft.wgName);
		if (draft?.creatorName) setCreatorName(draft.creatorName);
		if (draft?.joinName) setJoinName(draft.joinName);
		if (code) {
			setJoinCode(code);
			setStep('join');
		} else {
			if (draft?.joinCode) setJoinCode(draft.joinCode);
			if (draft?.step === 'joinName' && isJoinWg(draft.joinWg)) {
				setJoinWg(draft.joinWg);
				setStep('joinName');
			} else if (draft?.step === 'create' || draft?.step === 'join') setStep(draft.step);
			else if (draft?.joinCode) setStep('join');
			else if (searchParams.get('action') === 'create') setStep('create');
		}
		setInteractive(true);
	}, []);

	useEffect(() => {
		if (!interactive) return;
		if (step === 'invite') {
			removeDraft(START_DRAFT_KEY);
			return;
		}
		const draft: StartDraft = {
			step,
			wgName,
			creatorName,
			joinCode,
			joinName,
			...(joinWg ? { joinWg } : {}),
		};
		const hasDraft = [wgName, creatorName, joinCode, joinName].some(
			(value) => value.trim().length > 0,
		);
		if (hasDraft) writeDraft(START_DRAFT_KEY, draft);
		else removeDraft(START_DRAFT_KEY);
	}, [creatorName, interactive, joinCode, joinName, joinWg, step, wgName]);

	async function createWg(): Promise<void> {
		if (busyRef.current) return;
		const trimmedWg = wgName.trim();
		const trimmedMe = creatorName.trim();
		if (trimmedWg.length === 0) return setError('WG-Name fehlt.');
		if (trimmedMe.length === 0) return setError('Dein Name fehlt.');
		busyRef.current = true;
		setBusy(true);
		setError(null);
		setInviteWarning(null);
		try {
			const res = await fetch('/api/wg', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: trimmedWg, creatorName: trimmedMe }),
			});
			if (!res.ok) {
				setError(createWgErrorMessage(res.status, await readStartError(res)));
				return;
			}
			const data = (await res.json()) as CreateResponse;
			try {
				setIdentity(data.wg.id, {
					memberId: data.creator.id,
					name: data.creator.name,
					...(data.creator.token ? { memberToken: data.creator.token } : {}),
				});
			} catch {
				setInviteWarning(identityStorageErrorMessage(data.wg.shareCode));
			}
			rememberWg({
				code: data.wg.shareCode,
				name: data.wg.name,
				lastVisitedAt: Date.now(),
			});
			removeDraft(START_DRAFT_KEY);
			setCreatedWg({ code: data.wg.shareCode, name: data.wg.name });
			setStep('invite');
		} catch {
			setError('WG konnte nicht erstellt werden: Prüfe deine Verbindung und versuche es erneut.');
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	async function verifyJoinCode(): Promise<void> {
		if (busyRef.current) return;
		const code = normalizeShareCode(joinCode);
		if (!isValidShareCode(code)) {
			setError('Code besteht aus 8 Zeichen (Großbuchstaben/Ziffern, ohne I/L/O/U).');
			return;
		}
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/wg/${encodeURIComponent(code)}`, { cache: 'no-store' });
			if (!res.ok) {
				const apiError = await readStartError(res);
				if (shouldFallbackToDirectJoin(res.status, apiError)) {
					router.push(`/wg/${encodeURIComponent(code)}`);
					return;
				}
				setError(joinErrorMessage(res.status, apiError));
				return;
			}
			const data = (await res.json()) as WgResponse;
			const existingIdentity = getIdentity(data.wg.id);
			if (existingIdentity) {
				rememberWg({ code: data.wg.shareCode, name: data.wg.name, lastVisitedAt: Date.now() });
				router.push(`/wg/${encodeURIComponent(data.wg.shareCode)}`);
				return;
			}
			if (data.wg.joiningEnabled === false) {
				setError(joinErrorMessage(403, 'joining_disabled'));
				return;
			}
			rememberWg({ code: data.wg.shareCode, name: data.wg.name, lastVisitedAt: Date.now() });
			setJoinWg({ id: data.wg.id, code: data.wg.shareCode, name: data.wg.name });
			setStep('joinName');
		} catch {
			setError(joinErrorMessage(0, ''));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	async function joinExistingWg(): Promise<void> {
		if (busyRef.current) return;
		const name = joinName.trim();
		if (!joinWg) return;
		if (name.length === 0) {
			setError('Dein Name fehlt.');
			return;
		}
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/wg/${encodeURIComponent(joinWg.code)}/members`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name }),
			});
			if (!res.ok) {
				const apiError = await readStartError(res);
				setError(joinErrorMessage(res.status, apiError));
				return;
			}
			const data = (await res.json()) as MemberResponse;
			try {
				setIdentity(joinWg.id, {
					memberId: data.member.id,
					name: data.member.name,
					...(data.member.token ? { memberToken: data.member.token } : {}),
				});
			} catch {
				rememberWg({ code: joinWg.code, name: joinWg.name, lastVisitedAt: Date.now() });
				setError(joinIdentityStorageErrorMessage(joinWg.code, data.member.name));
				return;
			}
			rememberWg({ code: joinWg.code, name: joinWg.name, lastVisitedAt: Date.now() });
			removeDraft(START_DRAFT_KEY);
			router.push(`/wg/${encodeURIComponent(joinWg.code)}`);
		} catch {
			setError(joinErrorMessage(0, ''));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	function backToChoose(): void {
		setStep('choose');
		setError(null);
		setJoinWg(null);
	}

	const recentWg = knownWgs[0] ?? null;

	return (
		<main
			id="main"
			tabIndex={-1}
			className="flex min-h-svh items-center justify-center bg-[var(--bg-base)] px-4 py-10 focus:outline-none"
			style={{
				paddingTop: 'calc(2.5rem + env(safe-area-inset-top, 0px))',
				paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))',
			}}
		>
			<div className="w-full max-w-sm">
				<header className="mb-7 text-center">
					<div className="mb-3 flex justify-center">
						<LogoMark size={48} radius={12} className="shrink-0 rounded-xl shadow-sm" />
					</div>
					<p className="text-[11.5px] font-medium uppercase tracking-[0.18em] text-[var(--text-3)]">
						ManaWG
					</p>
					<h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						{step === 'choose'
							? 'Loslegen'
							: step === 'create'
								? 'Neue WG erstellen'
								: step === 'join'
									? 'Per Code beitreten'
									: step === 'joinName'
										? 'Namen eintragen'
										: 'Mitbewohner einladen'}
					</h1>
					<p className="mt-2 text-sm text-[var(--text-2)]">
						{step === 'invite'
							? 'Schick den Code — Mitbewohner sind in 10 Sek dabei.'
							: step === 'joinName' && joinWg
								? `${joinWg.name} gefunden. Nur noch dein Name.`
								: 'WG-Organisation ohne Login.'}
					</p>
				</header>

				{step === 'choose' && (
					<div className="space-y-3">
						{recentWg && (
							<button
								type="button"
								disabled={!interactive}
								onClick={() => router.push(`/wg/${encodeURIComponent(recentWg.code)}`)}
								className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-4 py-3 text-left transition-colors hover:bg-[var(--accent)]/10 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
							>
								<div className="min-w-0">
									<div className="truncate text-[15px] font-medium text-[var(--text-1)]">
										Zurück zu {recentWg.name}
									</div>
									<div className="mt-0.5 text-[13px] text-[var(--text-3)]">
										Zuletzt verwendete WG öffnen.
									</div>
								</div>
								<ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden />
							</button>
						)}
						<div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]">
							<button
								type="button"
								disabled={!interactive}
								onClick={() => setStep('create')}
								className="flex w-full items-center justify-between gap-3 bg-[var(--accent)]/8 px-4 py-4 text-left transition-colors hover:bg-[var(--accent)]/12 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-[15px] font-semibold text-[var(--text-1)]">
											Neue WG erstellen
										</span>
										<span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-fg)]">
											Empfohlen
										</span>
									</div>
									<div className="mt-0.5 text-[13px] text-[var(--text-3)]">
										Du bekommst einen 8-stelligen Code zum Teilen.
									</div>
								</div>
								<ArrowRight className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
							</button>
							<button
								type="button"
								disabled={!interactive}
								onClick={() => setStep('join')}
								className="flex w-full items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-4 text-left transition-colors hover:bg-[var(--surface)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
							>
								<div className="min-w-0">
									<div className="text-[15px] font-medium text-[var(--text-1)]">
										Per Code beitreten
									</div>
									<div className="mt-0.5 text-[13px] text-[var(--text-3)]">
										Code von Mitbewohner:in eingeben.
									</div>
								</div>
								<ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden />
							</button>
						</div>
						<p className="px-1 text-center text-[12px] text-[var(--text-3)]">
							Kein Login. Der WG-Code ist euer Einladungsschlüssel.
						</p>
					</div>
				)}

				{step === 'create' && (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void createWg();
						}}
						className="space-y-4"
					>
						<Field
							id="wg-name"
							label="WG-Name"
							placeholder="z. B. WG Kurt-Schumacher"
							value={wgName}
							onChange={setWgName}
							maxLength={WG_NAME_MAX}
							autoComplete="organization"
						/>
						<Field
							id="creator-name"
							label="Dein Name"
							placeholder="z. B. Anna"
							value={creatorName}
							onChange={setCreatorName}
							maxLength={NAME_MAX}
							autoComplete="given-name"
						/>
						{error && <ErrorBox>{error}</ErrorBox>}
						{/* Button row: back on left, submit grows to fill remaining space on mobile */}
						<div className="flex items-center gap-2">
							<BackButton onClick={backToChoose} />
							<button
								type="submit"
								disabled={busy}
								aria-label={busy ? 'WG wird erstellt…' : 'WG erstellen'}
								className="inline-flex h-12 min-w-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--text-1)] px-5 text-[15px] font-semibold text-[var(--bg-base)] transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{busy ? (
									<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
								) : (
									<ArrowRight className="h-4 w-4" aria-hidden />
								)}
								WG erstellen
							</button>
						</div>
					</form>
				)}

				{step === 'invite' && createdWg && (
					<>
						{inviteWarning && <ErrorBox>{inviteWarning}</ErrorBox>}
						<InviteStep
							code={createdWg.code}
							wgName={createdWg.name}
							onSkip={() => router.push(`/wg/${encodeURIComponent(createdWg.code)}`)}
						/>
					</>
				)}

				{step === 'join' && (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void verifyJoinCode();
						}}
						className="space-y-4"
					>
						<div>
							<label
								htmlFor="join-code"
								className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
							>
								WG-Code
							</label>
							<input
								id="join-code"
								type="text"
								value={joinCode}
								onChange={(e) => {
									setJoinCode(e.target.value.toUpperCase());
									if (error) setError(null);
								}}
								maxLength={8}
								autoComplete="off"
								autoCapitalize="characters"
								inputMode="text"
								placeholder="ABCD1234"
								aria-describedby={error ? 'join-code-error' : 'join-code-hint'}
								aria-invalid={error !== null ? true : undefined}
								className={[
									'block h-12 w-full rounded-xl border bg-[var(--bg-base)] px-3 text-center font-mono text-[20px] font-medium tracking-[0.18em] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-all duration-200',
									error
										? 'border-[var(--danger)] focus-visible:border-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2'
										: 'border-[var(--border)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
								].join(' ')}
							/>
							<p id="join-code-hint" className="mt-1.5 text-[12px] text-[var(--text-3)]">
								8 Zeichen, ohne I, L, O und U.
							</p>
						</div>
						{error && <ErrorBox id="join-code-error">{error}</ErrorBox>}
						{/* Button row: same layout + height as create step */}
						<div className="flex items-center gap-2">
							<BackButton onClick={backToChoose} />
							<button
								type="submit"
								disabled={busy}
								aria-label={busy ? 'WG-Code wird geprüft…' : 'WG-Code prüfen'}
								className="inline-flex h-12 min-w-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--text-1)] px-5 text-[15px] font-semibold text-[var(--bg-base)] transition-all duration-150 hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{busy ? (
									<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
								) : (
									<ArrowRight className="h-4 w-4" aria-hidden />
								)}
								Code prüfen
							</button>
						</div>
					</form>
				)}

				{step === 'joinName' && joinWg && (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void joinExistingWg();
						}}
						className="space-y-4"
					>
						<div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
							<div className="truncate text-[15px] font-medium text-[var(--text-1)]">
								{joinWg.name}
							</div>
							<div className="mt-0.5 font-mono text-[12px] tracking-[0.16em] text-[var(--text-3)]">
								{joinWg.code}
							</div>
						</div>
						<Field
							id="join-name"
							label="Dein Name"
							placeholder="z. B. Samira"
							value={joinName}
							onChange={(value) => {
								setJoinName(value);
								if (error) setError(null);
							}}
							maxLength={NAME_MAX}
							autoComplete="given-name"
						/>
						{error && <ErrorBox>{error}</ErrorBox>}
						<div className="flex items-center gap-2">
							<BackButton onClick={() => setStep('join')} />
							<button
								type="submit"
								disabled={busy}
								aria-label={busy ? 'Du trittst der WG bei…' : 'WG beitreten'}
								className="inline-flex h-12 min-w-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--text-1)] px-5 text-[15px] font-semibold text-[var(--bg-base)] transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								{busy ? (
									<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
								) : (
									<ArrowRight className="h-4 w-4" aria-hidden />
								)}
								Beitreten
							</button>
						</div>
					</form>
				)}
			</div>
		</main>
	);
}

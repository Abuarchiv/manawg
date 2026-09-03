'use client';

import { SocialLoginButtons, type SocialProvider } from '@/components/auth/SocialLoginButtons';
import { BackButton } from '@/components/neu/BackButton';
import { ErrorBox } from '@/components/neu/ErrorBox';
import { Field } from '@/components/neu/Field';
import { InviteStep } from '@/components/neu/InviteStep';
import { safeNextPath } from '@/core/auth/next-path';
import { getInitialJoinCode, joinErrorMessage } from '@/core/infra/join-flow';
import { readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import { LogoMark } from '@/shared/components/ui/LogoMark';
import { rememberWg } from '@/shared/lib/identity';
import { isValidShareCode, normalizeShareCode } from '@/shared/lib/share-code';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const WG_NAME_MAX = 100;
const NAME_MAX = 80;
const START_DRAFT_KEY = 'manawg:draft:neu';

interface CreateResponse {
	wg: { id: string; shareCode: string; name: string };
	creator: { id: string; name: string };
}

interface WgResponse {
	wg: { id: string; shareCode: string; name: string; joiningEnabled?: boolean };
	currentMember?: { memberId: string; name: string };
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

interface AccountWg extends JoinWg {}

type StartStep = 'choose' | 'create' | 'join' | 'joinName' | 'invite';

function isNeuPath(path: string): boolean {
	try {
		return new URL(path, 'https://manawg.invalid').pathname === '/neu';
	} catch {
		return true;
	}
}

async function startSocialLogin(provider: SocialProvider, next: string): Promise<void> {
	const { startSocialLogin } = await import('@/core/auth/client');
	await startSocialLogin(provider, next);
}

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
	if (status === 401 && error === 'auth_required') {
		return 'Melde dich zuerst mit Google, Apple oder Facebook an.';
	}
	if (status === 400 && error === 'name_invalid') {
		return 'WG konnte nicht erstellt werden: Der WG-Name muss 1 bis 100 Zeichen haben.';
	}
	if (status === 400 && error === 'creator_name_invalid') {
		return 'WG konnte nicht erstellt werden: Dein Anzeigename muss 1 bis 80 Zeichen haben.';
	}
	if (status === 400 && (error === 'invalid_body' || error === 'invalid_json')) {
		return 'WG-Name und dein Anzeigename müssen ausgefüllt und kurz genug sein.';
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
function isJoinWg(value: unknown): value is JoinWg {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return (
		typeof Reflect.get(value, 'id') === 'string' &&
		typeof Reflect.get(value, 'code') === 'string' &&
		typeof Reflect.get(value, 'name') === 'string'
	);
}

function isAccountWg(value: unknown): value is AccountWg {
	return isJoinWg(value);
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
	const [accountWgs, setAccountWgs] = useState<AccountWg[]>([]);
	const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'authenticated' | 'error'>(
		'loading',
	);
	const [authRetryNonce, setAuthRetryNonce] = useState(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createdWg, setCreatedWg] = useState<CreatedWg | null>(null);
	const [interactive, setInteractive] = useState(false);
	const busyRef = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initializer — reads the saved draft and initial URL params once; adding searchParams would re-run on navigation and clobber in-progress step/draft state.
	useEffect(() => {
		const code = typeof window === 'undefined' ? '' : getInitialJoinCode(window.location.search);
		const draft = readDraft<StartDraft>(START_DRAFT_KEY);
		if (draft?.wgName) setWgName(draft.wgName);
		if (draft?.creatorName) setCreatorName(draft.creatorName);
		if (draft?.joinName) setJoinName(draft.joinName);
		if (code) {
			setJoinCode(code);
			setStep('join');
		} else if (searchParams.get('action') === 'create') {
			setStep('create');
		} else {
			if (draft?.joinCode) setJoinCode(draft.joinCode);
			if (draft?.step === 'joinName' && isJoinWg(draft.joinWg)) {
				setJoinWg(draft.joinWg);
				setStep('joinName');
			} else if (draft?.step === 'create' || draft?.step === 'join') setStep(draft.step);
			else if (draft?.joinCode) setStep('join');
		}
		setInteractive(true);
	}, []);

	useEffect(() => {
		if (!interactive) return;
		let cancelled = false;
		const loadAccountWgs = async () => {
			if (authRetryNonce > 0) setError(null);
			setAuthState('loading');
			try {
				const res = await fetch('/api/wg/mine', { cache: 'no-store' });
				if (cancelled) return;
				if (res.status === 401) {
					setAccountWgs([]);
					setAuthState('signed-out');
					return;
				}
				if (!res.ok) {
					setAuthState('error');
					return;
				}
				const data: unknown = await res.json();
				const wgs = Array.isArray(data)
					? data
					: data && typeof data === 'object' && Array.isArray(Reflect.get(data, 'wgs'))
						? Reflect.get(data, 'wgs')
						: null;
				if (!wgs) {
					setAuthState('error');
					return;
				}
				setAccountWgs(wgs.filter(isAccountWg));
				setAuthState('authenticated');
			} catch {
				if (!cancelled) setAuthState('error');
			}
		};
		void loadAccountWgs();
		return () => {
			cancelled = true;
		};
	}, [authRetryNonce, interactive]);

	useEffect(() => {
		if (authState !== 'authenticated') return;
		const next = safeNextPath(searchParams.get('next'));
		if (next === '/' || isNeuPath(next)) return;
		router.replace(next);
	}, [authState, router, searchParams]);

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

	function loginNextPath(): string {
		const params = new URLSearchParams();
		if (step === 'create') params.set('action', 'create');
		const code = joinCode || joinWg?.code;
		if ((step === 'join' || step === 'joinName') && code) {
			params.set('code', normalizeShareCode(code));
		}
		const next = safeNextPath(searchParams.get('next'));
		if (next !== '/' && !isNeuPath(next)) params.set('next', next);
		const query = params.toString();
		return query ? `/neu?${query}` : '/neu';
	}

	function returnToSignIn(): void {
		setAuthState('signed-out');
		setError(null);
		router.replace(loginNextPath());
	}

	async function createWg(): Promise<void> {
		if (busyRef.current) return;
		const trimmedWg = wgName.trim();
		const trimmedMe = creatorName.trim();
		if (trimmedWg.length === 0) return setError('WG-Name fehlt.');
		if (trimmedMe.length === 0) return setError('Dein Anzeigename fehlt.');
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch('/api/wg', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: trimmedWg, creatorName: trimmedMe }),
			});
			if (res.status === 401) {
				returnToSignIn();
				return;
			}
			if (!res.ok) {
				setError(createWgErrorMessage(res.status, await readStartError(res)));
				return;
			}
			const data = (await res.json()) as CreateResponse;
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
				if (res.status === 401) {
					returnToSignIn();
					return;
				}
				const apiError = await readStartError(res);
				setError(joinErrorMessage(res.status, apiError));
				return;
			}
			const data = (await res.json()) as WgResponse;
			if (data.currentMember) {
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
			setError('Dein Anzeigename fehlt.');
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
			if (res.status === 401) {
				returnToSignIn();
				return;
			}
			if (!res.ok) {
				const apiError = await readStartError(res);
				setError(
					apiError === 'auth_required'
						? 'Melde dich zuerst mit Google, Apple oder Facebook an.'
						: joinErrorMessage(res.status, apiError),
				);
				return;
			}
			await res.json();
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

	const callbackError = searchParams.get('error') === 'auth_callback';

	if (authState !== 'authenticated') {
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
							Mit deinem Account anmelden
						</h1>
						<p className="mt-2 text-sm text-[var(--text-2)]">
							Dein Account macht deine WG auf jedem Gerät verfügbar.
						</p>
					</header>

					{callbackError && (
						<ErrorBox>
							Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.
						</ErrorBox>
					)}
					{authState === 'error' && (
						<div className="mb-4 space-y-2">
							<ErrorBox>Deine Anmeldung konnte gerade nicht geprüft werden.</ErrorBox>
							<button
								type="button"
								onClick={() => setAuthRetryNonce((value) => value + 1)}
								className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-[13px] font-medium text-[var(--text-1)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
							>
								erneut prüfen
							</button>
						</div>
					)}

					{authState !== 'loading' && (
						<div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
							<p className="text-[13px] text-[var(--text-2)]">
								{step === 'create'
									? 'Melde dich an, danach kannst du deine neue WG erstellen.'
									: joinCode
										? 'Melde dich an, danach kannst du mit deinem Einladungscode beitreten.'
										: 'Melde dich an, um deine WGs wiederherzustellen oder loszulegen.'}
							</p>
							<SocialLoginButtons next={loginNextPath()} onOAuthStart={startSocialLogin} />
						</div>
					)}
				</div>
			</main>
		);
	}

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
								: 'Dein Account macht deine WG auf jedem Gerät verfügbar.'}
					</p>
				</header>
				{callbackError && (
					<div className="mb-4">
						<ErrorBox>
							Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.
						</ErrorBox>
					</div>
				)}

				{step === 'choose' && (
					<div className="space-y-3">
						{accountWgs.length > 0 && (
							<div className="space-y-2">
								<p className="px-1 text-[12px] font-medium text-[var(--text-3)]">Deine WGs</p>
								{accountWgs.map((accountWg) => (
									<button
										key={accountWg.id}
										type="button"
										onClick={() => router.push(`/wg/${encodeURIComponent(accountWg.code)}`)}
										className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-4 py-3 text-left transition-colors hover:bg-[var(--accent)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
									>
										<span className="truncate text-[15px] font-medium text-[var(--text-1)]">
											{accountWg.name}
										</span>
										<ArrowRight className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
									</button>
								))}
							</div>
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
							Der WG-Code ist euer Einladungsschlüssel. Dein Account sichert deine Daten.
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
						<div className="space-y-2">
							<p className="text-[13px] text-[var(--text-2)]">
								Dein Anzeigename wird in der WG angezeigt.
							</p>
						</div>
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
							label="Dein Anzeigename"
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
					<InviteStep
						code={createdWg.code}
						wgName={createdWg.name}
						onSkip={() => router.push(`/wg/${encodeURIComponent(createdWg.code)}`)}
					/>
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
							label="Dein Anzeigename"
							placeholder="z. B. Samira"
							value={joinName}
							onChange={(value) => {
								setJoinName(value);
								if (error) setError(null);
							}}
							maxLength={NAME_MAX}
							autoComplete="given-name"
						/>
						<p className="text-[13px] text-[var(--text-2)]">
							Der Code ist nur der Einladungsschlüssel. Dein Account schützt deinen Beitritt.
						</p>
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

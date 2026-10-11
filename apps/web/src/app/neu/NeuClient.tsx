'use client';

import { ErrorBox } from '@/components/app/ErrorBox';
import { CredentialsAuth } from '@/components/auth/CredentialsAuth';
import { SignUpPrompt } from '@/components/auth/SignUpPrompt';
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { useConfirmLogoutDiscard } from '@/components/entry/useConfirmLogoutDiscard';
import { Button } from '@/components/ui/button';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { isAuthPagePath } from '@/core/auth/auth-intent';
import { safeNextPath } from '@/core/auth/next-path';
import { normalizeShareCode } from '@/core/utils/share-code';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChooseStep } from './ChooseStep';
import { CreateStep } from './CreateStep';
import { InviteStep } from './InviteStep';
import { JoinCodeStep } from './JoinCodeStep';
import { JoinNameStep } from './JoinNameStep';
import { StartNotices } from './StartNotices';
import {
	getJoinCodeFromSearch,
	getNeuIntentFromSearch,
	getWgCodeFromPath,
	startSocialLogin,
} from './start-flow';
import { useAccountWgs } from './use-account-wgs';
import { useBusyLock } from './use-busy-lock';
import { useClearCallbackError } from './use-clear-callback-error';
import { useCreateWg } from './use-create-wg';
import { useJoinWg } from './use-join-wg';
import { useAccountNamePrefill, useSaveStartDraft, useStartDraft } from './use-start-draft';
import { useStartError } from './use-start-error';
import { useStepHistory } from './use-step-history';

export function NeuClient({ sessionless = false }: { sessionless?: boolean }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const {
		step,
		setStep,
		wgName,
		setWgName,
		creatorName,
		setCreatorName,
		joinCode,
		setJoinCode,
		joinName,
		setJoinName,
		joinWg,
		setJoinWg,
		interactive,
		resetDraft,
	} = useStartDraft();
	const { busy, busyRef, setBusy } = useBusyLock();
	const { error, invalidField, clearError, setFormError, setFieldError } = useStartError();
	const [accountSwitchError, setAccountSwitchError] = useState<string | null>(null);
	const [switching, setSwitching] = useState(false);
	const [credentialsBusy, setCredentialsBusy] = useState(false);
	// Keeps the retry button mounted (and focused) while the check reruns.
	const [retried, setRetried] = useState(false);
	const {
		accountWgs,
		setAccountWgs,
		authState,
		checkingSession,
		setAuthState,
		retryAuth,
		handleAuthenticated,
		signedInHere,
	} = useAccountWgs({ interactive, step, clearError });
	useAccountNamePrefill(authState === 'authenticated', setCreatorName, setJoinName);
	useSaveStartDraft({ interactive, step, wgName, creatorName, joinCode, joinName, joinWg });
	const { goTo, goBack } = useStepHistory({
		interactive,
		step,
		setStep,
		onPop: (target) => {
			clearError();
			if (target === 'choose') setJoinWg(null);
		},
		canEnter: (target) =>
			target === 'joinName' ? joinWg !== null : target === 'invite' ? createdWg !== null : true,
	});

	function loginNextPath(): string {
		const params = new URLSearchParams();
		if (step === 'create') params.set('action', 'create');
		const code = joinCode || getJoinCodeFromSearch(searchParams.toString()) || joinWg?.code;
		if ((step === 'join' || step === 'joinName') && code) {
			params.set('code', normalizeShareCode(code));
		}
		const next = safeNextPath(searchParams.get('next'));
		if (next !== '/' && !isAuthPagePath(next)) params.set('next', next);
		const query = params.toString();
		return query ? `/neu?${query}` : '/neu';
	}

	function explorationHref(): string {
		const code = getJoinCodeFromSearch(searchParams.toString());
		return code ? `/?code=${encodeURIComponent(code)}` : '/';
	}

	function returnToSignIn(): void {
		setAuthState('signed-out');
		clearError();
		router.replace(loginNextPath());
	}

	useEffect(() => {
		if (authState !== 'loading') setRetried(false);
	}, [authState]);

	const { confirmDiscard, dialog: logoutDiscardDialog } = useConfirmLogoutDiscard();
	const errorActions = { clearError, setFormError, setFieldError };
	const { createdWg, setCreatedWg, createWg } = useCreateWg({
		wgName,
		creatorName,
		setStep: goTo,
		busyRef,
		setBusy,
		...errorActions,
		returnToSignIn,
	});
	const { verifyJoinCode, joinExistingWg } = useJoinWg({
		joinCode,
		joinName,
		joinWg,
		setJoinWg,
		setStep: goTo,
		busyRef,
		setBusy,
		...errorActions,
		returnToSignIn,
		sessionless,
	});

	async function switchAccount(): Promise<void> {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setSwitching(true);
		setAccountSwitchError(null);
		try {
			const { signOutSocialAccount } = await import('@/core/auth/client');
			const pushTargets = accountWgs.flatMap((wg) =>
				wg.memberId ? [{ code: wg.code, memberId: wg.memberId }] : [],
			);
			const { pushCleanup, cancelled } = await signOutSocialAccount(pushTargets, {
				confirmDiscard,
			});
			if (cancelled) return;
			resetDraft(getNeuIntentFromSearch(searchParams.toString()));
			setCreatedWg(null);
			clearError();
			setAccountWgs([]);
			setAuthState('signed-out');
			if (pushCleanup === 'failed') {
				setAccountSwitchError(
					'Du bist abgemeldet, aber Push konnte auf diesem Browser nicht sicher beendet werden. Deaktiviere Website-Benachrichtigungen in den Browsereinstellungen.',
				);
			}
		} catch {
			setAccountSwitchError('Konto konnte nicht abgemeldet werden. Bitte versuche es erneut.');
		} finally {
			busyRef.current = false;
			setBusy(false);
			setSwitching(false);
		}
	}

	// Back to the choose step drops the focused button; land on the heading instead.
	const previousStepRef = useRef(step);
	useEffect(() => {
		if (previousStepRef.current !== step && step === 'choose') {
			document.getElementById('neu-heading')?.focus();
		}
		previousStepRef.current = step;
	}, [step]);

	// The static metadata title names the WG flow; the signed-out page shows the sign-in form.
	const showsSignIn = authState !== 'authenticated' && !checkingSession;
	useEffect(() => {
		if (!showsSignIn) return;
		const previous = document.title;
		document.title = 'Anmelden — ManaWG';
		return () => {
			document.title = previous;
		};
	}, [showsSignIn]);

	useClearCallbackError(signedInHere);

	const movedOut = searchParams.get('reason') === 'moved_out';
	const deniedWgCode = (() => {
		const code = getWgCodeFromPath(safeNextPath(searchParams.get('next')));
		return code && !accountWgs.some((accountWg) => accountWg.code === code) ? code : null;
	})();

	if (authState !== 'authenticated') {
		return (
			<EntryFrame
				title={checkingSession ? 'Deine WG' : 'Anmelden'}
				headingId="auth-heading"
				description={
					checkingSession
						? undefined
						: step === 'create'
							? 'Melde dich an, danach erstellst du deine neue WG.'
							: joinCode
								? 'Melde dich an, um mit deinem WG-Code beizutreten.'
								: undefined
				}
				backHref={explorationHref()}
			>
				{accountSwitchError && <ErrorBox>{accountSwitchError}</ErrorBox>}
				<StartNotices search={searchParams.toString()} signedIn={false} />
				{(authState === 'error' || (retried && authState === 'loading')) && (
					<div className="flex flex-col gap-2">
						<ErrorBox>Deine Anmeldung konnte gerade nicht geprüft werden.</ErrorBox>
						<Button
							variant="outline"
							focusableWhenDisabled
							disabled={retried}
							aria-busy={retried}
							className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
							onClick={() => {
								setRetried(true);
								retryAuth();
							}}
						>
							{retried && <Spinner data-icon="inline-start" aria-hidden />}
							{retried ? 'Prüfe …' : 'Erneut prüfen'}
						</Button>
					</div>
				)}
				{authState === 'loading' ? (
					<output
						aria-live="polite"
						aria-label="Anmeldung wird geprüft"
						className="flex flex-col gap-4"
					>
						{checkingSession ? (
							// Shaped like the two choose buttons that replace it.
							<div className="flex flex-col gap-2">
								<Skeleton className="h-9 w-full" />
								<Skeleton className="h-9 w-full" />
							</div>
						) : (
							// Shaped like the sign-in form (Google, separator, two fields, link, two buttons).
							<>
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-5 w-full" />
								<Skeleton className="h-[4.5rem] w-full" />
								<Skeleton className="h-24 w-full" />
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-[4.5rem] w-full" />
							</>
						)}
						<span className="sr-only">Anmeldung wird geprüft</span>
					</output>
				) : (
					<FieldGroup>
						<SocialLoginButtons
							next={loginNextPath()}
							onOAuthStart={startSocialLogin}
							disabled={credentialsBusy}
						/>
						<FieldSeparator>oder</FieldSeparator>
						<CredentialsAuth
							next={loginNextPath()}
							onAuthenticated={handleAuthenticated}
							onBusyChange={setCredentialsBusy}
						/>
						<SignUpPrompt intentQuery={loginNextPath().split('?')[1] ?? ''} />
					</FieldGroup>
				)}
				{!checkingSession && <LegalLinks consent />}
			</EntryFrame>
		);
	}

	return (
		<EntryFrame
			headingId="neu-heading"
			title={
				step === 'choose'
					? 'Deine WG'
					: step === 'create'
						? 'Neue WG erstellen'
						: step === 'join'
							? 'Per Code beitreten'
							: step === 'joinName'
								? 'Dein Name in der WG'
								: 'WG erstellt'
			}
			description={
				step === 'invite'
					? 'Deine WG ist erstellt. Jetzt kannst du die Einladung teilen.'
					: step === 'joinName'
						? 'Mit diesem Namen sehen dich deine Mitbewohner.'
						: step === 'create'
							? 'Gib eurer WG einen Namen. Danach erhältst du euren WG-Code.'
							: step === 'join'
								? 'Gib den WG-Code deiner Mitbewohner ein.'
								: accountWgs.length > 0
									? 'Öffne eine deiner WGs, erstelle eine neue oder tritt per Code bei.'
									: 'Du hast noch keine WG. Erstelle eine neue oder tritt mit einem Code bei.'
			}
			backHref={explorationHref()}
		>
			<StartNotices search={searchParams.toString()} signedIn />
			{accountSwitchError && <ErrorBox>{accountSwitchError}</ErrorBox>}
			{deniedWgCode && step === 'choose' && (
				<ErrorBox>
					{movedOut
						? `Du bist in der WG ${deniedWgCode} als ausgezogen markiert. Eine Admin-Person kann dich wieder aktivieren.`
						: `Der Link zur WG ${deniedWgCode} ist veraltet, oder du bist mit diesem Konto nicht Mitglied. Wähle eine deiner WGs oder tritt mit dem WG-Code bei.`}
				</ErrorBox>
			)}
			{step === 'choose' && (
				<ChooseStep
					accountWgs={accountWgs}
					interactive={interactive}
					busy={busy}
					onCreate={() => goTo('create')}
					onJoin={() => goTo('join')}
				/>
			)}
			{step === 'create' && (
				<CreateStep
					wgName={wgName}
					onWgNameChange={setWgName}
					creatorName={creatorName}
					onCreatorNameChange={setCreatorName}
					error={error}
					invalidField={invalidField}
					clearError={clearError}
					busy={busy}
					onSubmit={() => void createWg()}
					onBack={() => goBack('choose')}
				/>
			)}
			{step === 'invite' && createdWg && (
				<InviteStep
					code={createdWg.code}
					wgName={createdWg.name}
					onSkip={() => router.push(`/wg/${encodeURIComponent(createdWg.code)}`)}
				/>
			)}
			{step === 'join' && (
				<JoinCodeStep
					joinCode={joinCode}
					onJoinCodeChange={setJoinCode}
					error={error}
					invalidField={invalidField}
					clearError={clearError}
					busy={busy}
					onSubmit={() => void verifyJoinCode()}
					onBack={() => goBack('choose')}
				/>
			)}
			{step === 'joinName' && joinWg && (
				<JoinNameStep
					joinWg={joinWg}
					joinName={joinName}
					onJoinNameChange={setJoinName}
					error={error}
					invalidField={invalidField}
					clearError={clearError}
					busy={busy}
					onSubmit={() => void joinExistingWg()}
					onBack={() => goBack('join')}
				/>
			)}
			{step !== 'invite' && (
				<Button
					type="button"
					variant="link"
					onClick={() => void switchAccount()}
					disabled={busy}
					className="w-fit px-0 text-left text-muted-foreground underline underline-offset-4"
				>
					{switching ? 'Bitte warten…' : 'Mit anderem Konto anmelden'}
				</Button>
			)}
			{logoutDiscardDialog}
		</EntryFrame>
	);
}

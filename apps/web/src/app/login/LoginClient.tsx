'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useAccountNamePrefill } from '@/app/use-account-name-prefill';
import { ErrorBox } from '@/components/app/ErrorBox';
import { CredentialsAuth } from '@/components/auth/CredentialsAuth';
import { useGoogleSignIn } from '@/components/auth/google-sign-in';
import { SignUpPrompt } from '@/components/auth/SignUpPrompt';
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { useConfirmLogoutDiscard } from '@/components/entry/use-confirm-logout-discard';
import { Button } from '@/components/ui/button';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { isAuthPagePath } from '@/core/auth/auth-intent';
import { safeNextPath } from '@/core/auth/next-path';
import { invitePath } from '@/core/utils/invite-token';
import { useMessage } from '@/shared/i18n/message';
import { ChooseStep } from './ChooseStep';
import { CreateStep } from './CreateStep';
import { InviteStep } from './InviteStep';
import { JoinInviteStep } from './JoinInviteStep';
import { StartNotices } from './StartNotices';
import {
	getLoginIntentFromSearch,
	getWgCodeFromPath,
	resolveInviteInput,
	startSocialLogin,
} from './start-flow';
import { useAccountWgs } from './use-account-wgs';
import { useBusyLock } from './use-busy-lock';
import { useClearCallbackError } from './use-clear-callback-error';
import { useCreateWg } from './use-create-wg';
import { useSaveStartDraft, useStartDraft } from './use-start-draft';
import { useStartError } from './use-start-error';
import { useStepHistory } from './use-step-history';

export function LoginClient() {
	const t = useTranslations('entry.start');
	const te = useTranslations('entry');
	const render = useMessage();
	const router = useRouter();
	const searchParams = useSearchParams();
	const {
		step,
		setStep,
		wgName,
		setWgName,
		creatorName,
		setCreatorName,
		inviteLink,
		setInviteLink,
		interactive,
		resetDraft,
	} = useStartDraft();
	const { busy, busyRef, setBusy } = useBusyLock();
	const { error, invalidField, clearError, setFormError, setFieldError } = useStartError();
	const [accountSwitchError, setAccountSwitchError] = useState<string | null>(null);
	const [switching, setSwitching] = useState(false);
	const [credentialsBusy, setCredentialsBusy] = useState(false);
	const googleSignIn = useGoogleSignIn();
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
	useAccountNamePrefill(authState === 'authenticated', setCreatorName);
	// The account name can arrive after an early submit; the "fehlt" error must not outlive it.
	useEffect(() => {
		if (invalidField === 'creatorName' && creatorName.trim()) clearError();
	}, [creatorName, invalidField, clearError]);
	useSaveStartDraft({ interactive, step, wgName, creatorName });
	const { goTo, goBack } = useStepHistory({
		interactive,
		step,
		setStep,
		onPop: clearError,
		canEnter: (target) => (target === 'invite' ? createdWg !== null : true),
	});

	function loginNextPath(): string {
		const params = new URLSearchParams();
		if (step === 'create') params.set('action', 'create');
		const invite = getLoginIntentFromSearch(searchParams.toString()).inviteToken;
		const next = invite ? invitePath(invite) : safeNextPath(searchParams.get('next'));
		if (next !== '/' && !isAuthPagePath(next)) params.set('next', next);
		const query = params.toString();
		return query ? `/login?${query}` : '/login';
	}

	function explorationHref(): string {
		const invite = getLoginIntentFromSearch(searchParams.toString()).inviteToken;
		return invite ? `/?invite=${encodeURIComponent(invite)}` : '/';
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

	function openInvite(): void {
		const result = resolveInviteInput(inviteLink);
		if ('error' in result) {
			setFieldError('inviteLink', render(result.error));
			return;
		}
		router.push(invitePath(result.token));
	}

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
			// Drops the previous account's pages from the client router cache.
			router.refresh();
			resetDraft(getLoginIntentFromSearch(searchParams.toString()));
			setCreatedWg(null);
			clearError();
			setAccountWgs([]);
			setAuthState('signed-out');
			if (pushCleanup === 'failed') {
				setAccountSwitchError(t('pushFailed'));
			}
		} catch {
			setAccountSwitchError(te('signOut.failed'));
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
		document.title = `${t('titleSignIn')} — ManaWG`;
		return () => {
			document.title = previous;
		};
	}, [showsSignIn, t]);

	useClearCallbackError(signedInHere);

	const movedOut = searchParams.get('reason') === 'moved_out';
	const deniedWgCode = (() => {
		const code = getWgCodeFromPath(safeNextPath(searchParams.get('next')));
		return code && !accountWgs.some((accountWg) => accountWg.code === code) ? code : null;
	})();

	if (authState !== 'authenticated') {
		return (
			<EntryFrame
				title={checkingSession ? t('titleChoose') : t('titleSignIn')}
				headingId="auth-heading"
				description={
					checkingSession
						? undefined
						: step === 'create'
							? t('signInCreate')
							: getLoginIntentFromSearch(searchParams.toString()).inviteToken
								? t('signInInvite')
								: undefined
				}
				backHref={explorationHref()}
			>
				{accountSwitchError && <ErrorBox>{accountSwitchError}</ErrorBox>}
				<StartNotices search={searchParams.toString()} signedIn={false} />
				{(authState === 'error' || (retried && authState === 'loading')) && (
					<div className="flex flex-col gap-2">
						<ErrorBox>{t('authCheckFailed')}</ErrorBox>
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
							{retried ? te('public.rechecking') : te('public.recheck')}
						</Button>
					</div>
				)}
				{authState === 'loading' ? (
					<output aria-live="polite" aria-label={t('authChecking')} className="flex flex-col gap-4">
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
						<span className="sr-only">{t('authChecking')}</span>
					</output>
				) : (
					<FieldGroup>
						{googleSignIn && (
							<>
								<SocialLoginButtons
									next={loginNextPath()}
									onOAuthStart={startSocialLogin}
									disabled={credentialsBusy}
								/>
								<FieldSeparator>{t('or')}</FieldSeparator>
							</>
						)}
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
					? t('titleChoose')
					: step === 'create'
						? t('titleCreate')
						: step === 'join'
							? t('titleJoin')
							: t('titleCreated')
			}
			description={
				step === 'invite'
					? t('descCreated')
					: step === 'create'
						? t('descCreate')
						: step === 'join'
							? t('descJoin')
							: accountWgs.length > 0
								? t('descChooseSome')
								: t('descChooseNone')
			}
			backHref={explorationHref()}
		>
			<StartNotices search={searchParams.toString()} signedIn />
			{accountSwitchError && <ErrorBox>{accountSwitchError}</ErrorBox>}
			{deniedWgCode && step === 'choose' && (
				<ErrorBox>
					{movedOut
						? t('movedOut', { code: deniedWgCode })
						: t('deniedLink', { code: deniedWgCode })}
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
					memberId={createdWg.memberId}
					onSkip={() => router.push(`/wg/${encodeURIComponent(createdWg.code)}`)}
				/>
			)}
			{step === 'join' && (
				<JoinInviteStep
					inviteLink={inviteLink}
					onInviteLinkChange={setInviteLink}
					error={error}
					invalidField={invalidField}
					clearError={clearError}
					onSubmit={openInvite}
					onBack={() => goBack('choose')}
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
					{switching ? t('wait') : te('signOut.switch')}
				</Button>
			)}
			{logoutDiscardDialog}
		</EntryFrame>
	);
}

'use client';

import { CredentialsAuth } from '@/components/auth/CredentialsAuth';
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { ErrorBox } from '@/components/neu/ErrorBox';
import { InviteStep } from '@/components/neu/InviteStep';
import { Button } from '@/components/ui/button';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { safeNextPath } from '@/core/auth/next-path';
import { normalizeShareCode } from '@/core/utils/share-code';
import { getIdentity } from '@/shared/lib/identity';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ChooseStep } from './ChooseStep';
import { CreateStep } from './CreateStep';
import { JoinCodeStep } from './JoinCodeStep';
import { JoinNameStep } from './JoinNameStep';
import {
	getJoinCodeFromSearch,
	getNeuIntentFromSearch,
	getWgCodeFromPath,
	isNeuPath,
	startSocialLogin,
} from './start-flow';
import { useAccountWgs } from './use-account-wgs';
import { useBusyLock } from './use-busy-lock';
import { useCreateWg } from './use-create-wg';
import { useJoinWg } from './use-join-wg';
import { useSaveStartDraft, useStartDraft } from './use-start-draft';
import { useStartError } from './use-start-error';

export function NeuClient() {
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
	const [legacyOpen, setLegacyOpen] = useState(false);
	const { accountWgs, setAccountWgs, authState, setAuthState, retryAuth, handleAuthenticated } =
		useAccountWgs({ interactive, step, clearError });
	useSaveStartDraft({ interactive, step, wgName, creatorName, joinCode, joinName, joinWg });

	function loginNextPath(): string {
		const params = new URLSearchParams();
		if (step === 'create') params.set('action', 'create');
		const code = joinCode || getJoinCodeFromSearch(searchParams.toString()) || joinWg?.code;
		if ((step === 'join' || step === 'joinName') && code) {
			params.set('code', normalizeShareCode(code));
		}
		const next = safeNextPath(searchParams.get('next'));
		if (next !== '/' && !isNeuPath(next)) params.set('next', next);
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

	const errorActions = { clearError, setFormError, setFieldError };
	const { createdWg, setCreatedWg, createWg } = useCreateWg({
		wgName,
		creatorName,
		setStep,
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
		setStep,
		busyRef,
		setBusy,
		...errorActions,
		returnToSignIn,
	});

	async function switchAccount(): Promise<void> {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setAccountSwitchError(null);
		try {
			const { signOutSocialAccount } = await import('@/core/auth/client');
			const pushTargets = accountWgs.flatMap((wg) => {
				const identity = getIdentity(wg.id);
				return identity
					? [
							{
								code: wg.code,
								memberId: identity.memberId,
								...(identity.memberToken ? { memberToken: identity.memberToken } : {}),
							},
						]
					: [];
			});
			const { pushCleanup } = await signOutSocialAccount(pushTargets);
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
		}
	}

	function backToChoose(): void {
		setStep('choose');
		clearError();
		setJoinWg(null);
	}

	const callbackError = searchParams.get('error') === 'auth_callback';
	const deniedWgCode = (() => {
		const code = getWgCodeFromPath(safeNextPath(searchParams.get('next')));
		return code && !accountWgs.some((accountWg) => accountWg.code === code) ? code : null;
	})();

	if (authState !== 'authenticated') {
		return (
			<EntryFrame
				title="Anmelden"
				headingId="auth-heading"
				description={
					step === 'create'
						? 'Melde dich an, danach erstellst du deine neue WG.'
						: joinCode
							? 'Melde dich an, um mit deinem WG-Code beizutreten.'
							: undefined
				}
				backHref={explorationHref()}
			>
				{accountSwitchError && <ErrorBox>{accountSwitchError}</ErrorBox>}
				{callbackError && (
					<ErrorBox>
						Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.
					</ErrorBox>
				)}
				{authState === 'error' && (
					<div className="flex flex-col gap-2">
						<ErrorBox>Deine Anmeldung konnte gerade nicht geprüft werden.</ErrorBox>
						<Button variant="outline" onClick={() => retryAuth()}>
							Erneut prüfen
						</Button>
					</div>
				)}
				{authState === 'loading' ? (
					<output
						aria-live="polite"
						aria-label="Anmeldung wird geprüft"
						className="flex flex-col gap-4"
					>
						<Skeleton className="h-11 w-full" />
						<Skeleton className="h-40 w-full" />
						<span className="sr-only">Anmeldung wird geprüft</span>
					</output>
				) : (
					<FieldGroup>
						<SocialLoginButtons next={loginNextPath()} onOAuthStart={startSocialLogin} />
						<FieldSeparator>oder</FieldSeparator>
						<CredentialsAuth next={loginNextPath()} onAuthenticated={handleAuthenticated} />
					</FieldGroup>
				)}
				<LegalLinks consent />
			</EntryFrame>
		);
	}

	return (
		<EntryFrame
			title={
				step === 'choose'
					? 'Deine WG'
					: step === 'create'
						? 'Neue WG erstellen'
						: step === 'join'
							? 'Per Code beitreten'
							: step === 'joinName'
								? 'Dein Name in der WG'
								: (createdWg?.name ?? 'Mitbewohner einladen')
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
									? 'Öffne eine deiner WGs oder starte gemeinsam neu.'
									: 'Du hast noch keine WG. Erstelle eure oder tritt mit einem Code bei.'
			}
			backHref={explorationHref()}
			actions={
				step !== 'invite' ? (
					<Button
						type="button"
						variant="link"
						onClick={() => void switchAccount()}
						disabled={busy}
						className="w-fit px-0 text-muted-foreground underline underline-offset-4"
					>
						{busy ? 'Bitte warten…' : 'Mit anderem Konto anmelden'}
					</Button>
				) : undefined
			}
		>
			{callbackError && (
				<ErrorBox>
					Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.
				</ErrorBox>
			)}
			{accountSwitchError && <ErrorBox>{accountSwitchError}</ErrorBox>}
			{deniedWgCode && step === 'choose' && (
				<ErrorBox>
					Auf die WG {deniedWgCode} hast du mit diesem Konto keinen Zugriff. Wähle eine deiner WGs
					oder tritt mit dem WG-Code bei.
				</ErrorBox>
			)}

			{step === 'choose' && (
				<ChooseStep
					accountWgs={accountWgs}
					interactive={interactive}
					busy={busy}
					legacyOpen={legacyOpen}
					onLegacyOpenChange={setLegacyOpen}
					onCreate={() => setStep('create')}
					onJoin={() => setStep('join')}
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
					busy={busy}
					onSubmit={() => void createWg()}
					onBack={backToChoose}
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
					onBack={backToChoose}
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
					onBack={() => {
						clearError();
						setStep('join');
					}}
				/>
			)}
		</EntryFrame>
	);
}

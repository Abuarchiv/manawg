'use client';

import { ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { startSocialLogin } from '@/app/login/start-flow';
import { useAccountNamePrefill } from '@/app/use-account-name-prefill';
import { BackButton } from '@/components/app/BackButton';
import { ErrorBox } from '@/components/app/ErrorBox';
import { TextField } from '@/components/app/TextField';
import { useGoogleSignIn } from '@/components/auth/google-sign-in';
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { authPageHref } from '@/core/auth/auth-intent';
import { copyText } from '@/core/utils/clipboard';
import { invitePath } from '@/core/utils/invite-token';
import { cn } from '@/shared/lib/cn';
import { MEMBER_NAME_MAX_LENGTH } from '@/shared/lib/limits';
import { useInviteJoin } from './use-invite-join';

const COPIED_RESET_MS = 1500;

/** A dead link ends the visit; this copies a ready-made request for a new link to send to the inviter. */
function CopyExpiredMessage() {
	const t = useTranslations('entry.invite');
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const timerRef = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		},
		[],
	);
	async function copy(): Promise<void> {
		if (!(await copyText(t('expiredMessage')))) return setCopyFailed(true);
		setCopyFailed(false);
		setCopied(true);
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
	}
	return (
		<>
			<Button type="button" variant="outline" className="w-full" onClick={() => void copy()}>
				{copied && <Check data-icon="inline-start" aria-hidden />}
				{copied ? t('messageCopied') : t('copyMessage')}
			</Button>
			{copyFailed && <p className="select-all text-sm text-foreground">{t('expiredMessage')}</p>}
			<span aria-live="polite" className="sr-only">
				{copied ? t('messageCopied') : ''}
			</span>
		</>
	);
}

/** The page behind an invitation link: sign in if needed, show the WG, ask for a name, join. */
export function InviteClient({ token }: { token: string }) {
	const t = useTranslations('entry');
	const ts = useTranslations('entry.start');
	const router = useRouter();
	const { phase, preview, name, setName, error, nameInvalid, busy, join, retry, deadMessage } =
		useInviteJoin(token);
	const googleSignIn = useGoogleSignIn();
	const nameLookedUp = useAccountNamePrefill(phase.kind === 'ready', setName);
	// With the account name known, joining is one tap; the field only opens on request or on a name
	// error. It waits for the name lookup, so it neither flashes open nor opens the keyboard early.
	const [editing, setEditing] = useState(false);
	const noName = name.trim() === '';
	const showField = nameLookedUp && (editing || nameInvalid || noName);
	useEffect(() => {
		if (nameLookedUp && noName) document.getElementById('join-name')?.focus();
	}, [nameLookedUp, noName]);
	const next = encodeURIComponent(invitePath(token));

	if (phase.kind === 'signed-out') {
		const guestTitle = preview
			? preview.inviterName
				? t('invite.guestTitle', { inviter: preview.inviterName, wgName: preview.wgName })
				: t('invite.guestTitleAnonymous', { wgName: preview.wgName })
			: t('invite.title');
		return (
			<EntryFrame
				title={guestTitle}
				headingId="invite-heading"
				description={t('invite.signInBody')}
				actions={
					<>
						<p className="text-xs text-muted-foreground">{t('invite.guestReason')}</p>
						{preview && preview.memberCount >= 2 && (
							<p className="text-xs font-medium text-foreground">
								{t('invite.guestMembers', { count: preview.memberCount })}
							</p>
						)}
					</>
				}
			>
				<div className="flex flex-col gap-3">
					{googleSignIn && (
						<>
							<SocialLoginButtons
								variant="sign-up"
								next={authPageHref('/login', `next=${next}`)}
								onOAuthStart={startSocialLogin}
							/>
							<FieldSeparator>{ts('or')}</FieldSeparator>
						</>
					)}
					<Link href={`/signup?next=${next}`} className={cn(buttonVariants(), 'w-full')}>
						{t('invite.createAccount')}
					</Link>
					<Link
						href={`/login?next=${next}`}
						className="-my-3 inline-block self-center py-3 text-sm font-medium text-foreground underline underline-offset-4"
					>
						{t('invite.haveAccount')}
					</Link>
				</div>
				<LegalLinks registration />
			</EntryFrame>
		);
	}

	if (phase.kind === 'dead') {
		return (
			<EntryFrame title={t('invite.invalidTitle')} headingId="invite-heading">
				<ErrorBox>{deadMessage}</ErrorBox>
				<CopyExpiredMessage />
				<Link href="/login" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
					{t('invite.toFlats')}
				</Link>
			</EntryFrame>
		);
	}

	if (phase.kind === 'error') {
		return (
			<EntryFrame title={t('invite.heading')} headingId="invite-heading">
				<ErrorBox>{t('invite.checkFailed')}</ErrorBox>
				<Button type="button" variant="outline" onClick={retry}>
					{t('invite.recheck')}
				</Button>
			</EntryFrame>
		);
	}

	if (phase.kind === 'loading') {
		return (
			<EntryFrame title={t('invite.heading')} headingId="invite-heading">
				<output
					aria-live="polite"
					aria-label={t('invite.checking')}
					className="flex flex-col gap-3"
				>
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<span className="sr-only">{t('invite.checking')}</span>
				</output>
			</EntryFrame>
		);
	}

	return (
		<EntryFrame
			title={t('invite.joinTitle', { wgName: phase.wgName })}
			headingId="invite-heading"
			description={t('invite.joinBody')}
		>
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void join();
				}}
				className="flex flex-col gap-5"
			>
				{showField ? (
					<FieldGroup>
						<TextField
							id="join-name"
							label={ts('displayName')}
							placeholder={ts('displayNamePlaceholder')}
							value={name}
							onChange={(value) => {
								setEditing(true);
								setName(value);
							}}
							maxLength={MEMBER_NAME_MAX_LENGTH}
							autoComplete="given-name"
							autoFocus={editing || nameInvalid}
							required
							invalid={nameInvalid}
							describedBy={nameInvalid ? 'join-name-error' : undefined}
							enterKeyHint="done"
						/>
						{error && nameInvalid && <ErrorBox id="join-name-error">{error}</ErrorBox>}
					</FieldGroup>
				) : null}
				{error && !nameInvalid && <ErrorBox id="join-name-form-error">{error}</ErrorBox>}
				<div className="flex flex-col gap-2">
					<Button type="submit" disabled={busy || !nameLookedUp} className="w-full">
						{busy ? (
							<Spinner data-icon="inline-start" aria-hidden />
						) : (
							<ArrowRight data-icon="inline-start" aria-hidden />
						)}
						{busy
							? t('invite.joining')
							: showField || !nameLookedUp
								? t('invite.join')
								: t('invite.joinAs', { name: name.trim() })}
					</Button>
					<div className="flex items-center justify-between gap-2">
						<BackButton onClick={() => router.push('/login')} disabled={busy} />
						{!showField && !noName && (
							<button
								type="button"
								onClick={() => setEditing(true)}
								disabled={busy}
								className="relative min-h-8 px-2 text-sm font-medium text-foreground underline underline-offset-4 after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] disabled:opacity-50"
							>
								{t('invite.changeName')}
							</button>
						)}
					</div>
				</div>
			</form>
		</EntryFrame>
	);
}

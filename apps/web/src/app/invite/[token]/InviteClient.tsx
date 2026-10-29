'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAccountNamePrefill } from '@/app/use-account-name-prefill';
import { BackButton } from '@/components/app/BackButton';
import { ErrorBox } from '@/components/app/ErrorBox';
import { TextField } from '@/components/app/TextField';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { invitePath } from '@/core/utils/invite-token';
import { cn } from '@/shared/lib/cn';
import { MEMBER_NAME_MAX_LENGTH } from '@/shared/lib/limits';
import { useInviteJoin } from './use-invite-join';

/** The page behind an invitation link: sign in if needed, show the WG, ask for a name, join. */
export function InviteClient({ token }: { token: string }) {
	const t = useTranslations('entry');
	const ts = useTranslations('entry.start');
	const router = useRouter();
	const { phase, name, setName, error, nameInvalid, busy, join, retry, deadMessage } =
		useInviteJoin(token);
	useAccountNamePrefill(phase.kind === 'ready', setName);
	const next = encodeURIComponent(invitePath(token));

	if (phase.kind === 'signed-out') {
		return (
			<EntryFrame
				title={t('invite.title')}
				headingId="invite-heading"
				description={t('invite.signInBody')}
			>
				<div className="flex flex-col gap-2">
					<Link href={`/login?next=${next}`} className={cn(buttonVariants(), 'w-full')}>
						{t('invite.signIn')}
					</Link>
					<Link
						href={`/signup?next=${next}`}
						className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
					>
						{t('invite.createAccount')}
					</Link>
				</div>
				<LegalLinks consent />
			</EntryFrame>
		);
	}

	if (phase.kind === 'dead') {
		return (
			<EntryFrame title={t('invite.invalidTitle')} headingId="invite-heading">
				<ErrorBox>{deadMessage}</ErrorBox>
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
				<FieldGroup>
					<TextField
						id="join-name"
						label={ts('displayName')}
						placeholder={ts('displayNamePlaceholder')}
						value={name}
						onChange={setName}
						maxLength={MEMBER_NAME_MAX_LENGTH}
						autoComplete="given-name"
						autoFocus
						required
						invalid={nameInvalid}
						describedBy={nameInvalid ? 'join-name-error' : undefined}
						enterKeyHint="done"
					/>
					{error && nameInvalid && <ErrorBox id="join-name-error">{error}</ErrorBox>}
				</FieldGroup>
				{error && !nameInvalid && <ErrorBox id="join-name-form-error">{error}</ErrorBox>}
				<div className="flex flex-wrap items-center gap-2">
					<BackButton onClick={() => router.push('/login')} disabled={busy} />
					<Button type="submit" disabled={busy} className="flex-1">
						{busy ? (
							<Spinner data-icon="inline-start" aria-hidden />
						) : (
							<ArrowRight data-icon="inline-start" aria-hidden />
						)}
						{busy ? t('invite.joining') : t('invite.join')}
					</Button>
				</div>
			</form>
		</EntryFrame>
	);
}

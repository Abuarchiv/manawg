'use client';

import { Check, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ErrorBox } from '@/components/app/ErrorBox';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/shared/lib/cn';
import { useAgentConsent } from './use-agent-consent';

/** OAuth consent for an AI agent: sign in if needed, show who asks and what it may do, decide. */
export function ConsentClient({ authorizationId }: { authorizationId: string }) {
	const t = useTranslations('entry.agentConsent');
	const { phase, decision, decideFailed, decide, retry } = useAgentConsent(authorizationId);
	const next = encodeURIComponent(
		`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`,
	);

	if (phase.kind === 'signed-out') {
		return (
			<EntryFrame title={t('title')} headingId="consent-heading" description={t('signInBody')}>
				<div className="flex flex-col gap-2">
					<Link href={`/login?next=${next}`} className={cn(buttonVariants(), 'w-full')}>
						{t('signIn')}
					</Link>
					<Link
						href={`/signup?next=${next}`}
						className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
					>
						{t('createAccount')}
					</Link>
				</div>
			</EntryFrame>
		);
	}

	if (phase.kind === 'invalid') {
		return (
			<EntryFrame
				title={t('invalidTitle')}
				headingId="consent-heading"
				description={t('invalidBody')}
			>
				<Link href="/login" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>
					{t('toApp')}
				</Link>
			</EntryFrame>
		);
	}

	if (phase.kind === 'error') {
		return (
			<EntryFrame title={t('title')} headingId="consent-heading">
				<ErrorBox>{t('checkFailed')}</ErrorBox>
				<Button type="button" variant="outline" onClick={retry}>
					{t('recheck')}
				</Button>
			</EntryFrame>
		);
	}

	if (phase.kind === 'loading' || phase.kind === 'returning') {
		const label = phase.kind === 'loading' ? t('checking') : t('returning');
		return (
			<EntryFrame title={t('title')} headingId="consent-heading">
				<output aria-live="polite" aria-label={label} className="flex flex-col gap-3">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<span className="sr-only">{label}</span>
				</output>
			</EntryFrame>
		);
	}

	const client = phase.clientName ?? t('unnamedClient');
	const busy = decision !== null;
	return (
		<EntryFrame
			title={t('consentTitle', { client })}
			headingId="consent-heading"
			description={phase.clientHost ? t('from', { host: phase.clientHost }) : undefined}
		>
			<div className="flex flex-col gap-3 text-sm">
				<p>{t('consentBody', { email: phase.email })}</p>
				<p className="text-muted-foreground">{t('limits')}</p>
			</div>
			{decideFailed && <ErrorBox>{t('decideFailed')}</ErrorBox>}
			<div className="flex flex-col gap-2">
				<Button type="button" disabled={busy} onClick={() => void decide(true)} className="w-full">
					{decision === 'approve' ? <Spinner aria-hidden /> : <Check aria-hidden />}
					{decision === 'approve' ? t('approving') : t('approve')}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={busy}
					onClick={() => void decide(false)}
					className="w-full"
				>
					{decision === 'deny' ? <Spinner aria-hidden /> : <X aria-hidden />}
					{decision === 'deny' ? t('denying') : t('deny')}
				</Button>
			</div>
		</EntryFrame>
	);
}

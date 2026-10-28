'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Section } from '@/components/wg/einstellungen/Section';
import { noteSessionExpiry } from '@/core/infra/api-client';
import { UserX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export function AccountDeleteSection() {
	const t = useTranslations('settings.accountDelete');
	const common = useTranslations('common');
	const actions = useTranslations('settings.actions');
	const confirmWord = t('confirmWord');
	const signInAgain = t('signInAgain');
	const [stage, setStage] = useState<'idle' | 'confirm' | 'pending'>('idle');
	const [confirmText, setConfirmText] = useState('');
	const [error, setError] = useState<string | null>(null);
	// Focus the cancel button so iOS does not open the keyboard unprompted.
	const cancelRef = useRef<HTMLButtonElement>(null);

	// With large text the message lies below the visible dialog area.
	useEffect(() => {
		if (error)
			document.getElementById('delete-account-error')?.scrollIntoView({ block: 'nearest' });
	}, [error]);

	async function handleDelete(): Promise<void> {
		setStage('pending');
		setError(null);
		try {
			const res = await fetch('/api/account', { method: 'DELETE' });
			noteSessionExpiry(res);
			if (res.status === 503) {
				const result = await res.json().catch(() => null);
				if (
					result?.status === 'unknown' &&
					result?.error === 'account_deletion_outcome_unconfirmed'
				) {
					setError(t('unknownOutcome'));
					setStage('confirm');
					return;
				}
				if (result?.error === 'account_deletion_unavailable') {
					setError(t('unavailable'));
					setStage('confirm');
					return;
				}
			}
			if (res.status === 401) {
				setError(signInAgain);
				setStage('confirm');
				return;
			}
			if (res.status === 429) {
				setError(common('errors.rateLimited'));
				setStage('confirm');
				return;
			}
			if (res.status !== 200 && res.status !== 202) {
				setError(t('failed'));
				setStage('confirm');
				return;
			}
			const pending = res.status === 202;
			try {
				const { clearLocalAccountData, signOutSocialAccount } = await import('@/core/auth/client');
				await signOutSocialAccount().catch(() => {
					// The server already removed WG access; a stale local session is harmless.
				});
				await clearLocalAccountData();
			} catch {
				// Browser storage failure does not change the server's accepted deletion.
			}
			window.location.assign(pending ? '/?accountDeletion=pending' : '/');
		} catch {
			setError(t('unknownOutcome'));
			setStage('confirm');
		}
	}

	const armed = confirmText === confirmWord;

	const trigger = (
		<Button
			type="button"
			variant="destructive"
			onClick={() => {
				setStage('confirm');
				setConfirmText('');
				setError(null);
			}}
			className="w-full"
		>
			<UserX aria-hidden />
			{t('trigger')}
		</Button>
	);

	return (
		<>
			<Section title={t('title')} hint={t('hint')}>
				<div className="p-3">{trigger}</div>
			</Section>

			<AlertDialog
				open={stage !== 'idle'}
				onOpenChange={(open) => {
					if (!open && stage !== 'pending') setStage('idle');
				}}
			>
				<AlertDialogContent initialFocus={cancelRef}>
					<AlertDialogHeader>
						<AlertDialogMedia>
							<UserX aria-hidden />
						</AlertDialogMedia>
						<AlertDialogTitle>{t('dialogTitle')}</AlertDialogTitle>
						<AlertDialogDescription>{t('dialogBody')}</AlertDialogDescription>
					</AlertDialogHeader>
					<Field>
						<FieldLabel htmlFor="delete-account-confirm">
							{t('typeWord', { word: confirmWord })}
						</FieldLabel>
						<Input
							id="delete-account-confirm"
							type="text"
							value={confirmText}
							onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
							placeholder={confirmWord}
							aria-describedby="delete-account-confirm-hint"
							disabled={stage === 'pending'}
							className="text-center font-mono text-base tracking-[0.18em]"
							autoComplete="off"
						/>
						<FieldDescription id="delete-account-confirm-hint">{t('exportHint')}</FieldDescription>
					</Field>
					{error && (
						<Alert variant="destructive" id="delete-account-error">
							<AlertDescription>
								<div>{error}</div>
								{error === signInAgain && (
									<Button
										variant="outline"
										size="sm"
										className="mt-2 no-underline!"
										render={<Link href="/neu" />}
										nativeButton={false}
									>
										{t('signInAgainBtn')}
									</Button>
								)}
							</AlertDescription>
						</Alert>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel ref={cancelRef} disabled={stage === 'pending'}>
							{actions('cancel')}
						</AlertDialogCancel>
						<Button
							variant={armed ? 'destructive-solid' : 'destructive'}
							onClick={(event) => {
								event.preventDefault();
								void handleDelete();
							}}
							disabled={stage === 'pending' || !armed}
						>
							{stage === 'pending' ? <Spinner aria-hidden /> : <UserX aria-hidden />}
							{t('confirm')}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

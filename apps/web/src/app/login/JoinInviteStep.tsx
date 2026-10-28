'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/app/BackButton';
import { ErrorBox } from '@/components/app/ErrorBox';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldGroup, FieldLabel, Field as UiField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { StartField } from './start-flow';

interface JoinInviteStepProps {
	/** Origin of this instance, resolved on the server, for the example link in the field. */
	appOrigin: string;
	inviteLink: string;
	onInviteLinkChange: (value: string) => void;
	error: string | null;
	invalidField: StartField | null;
	clearError: () => void;
	onSubmit: () => void;
	onBack: () => void;
}

export function JoinInviteStep({
	appOrigin,
	inviteLink,
	onInviteLinkChange,
	error,
	invalidField,
	clearError,
	onSubmit,
	onBack,
}: JoinInviteStepProps) {
	const t = useTranslations('entry.start');
	const invalid = invalidField === 'inviteLink';
	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
			className="flex flex-col gap-5"
		>
			<FieldGroup>
				<UiField data-invalid={invalid}>
					<FieldLabel htmlFor="invite-link">{t('inviteLink')}</FieldLabel>
					<Input
						id="invite-link"
						type="text"
						value={inviteLink}
						onChange={(event) => {
							onInviteLinkChange(event.target.value);
							if (error) clearError();
						}}
						required
						autoFocus
						autoComplete="off"
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
						inputMode="url"
						enterKeyHint="go"
						placeholder={t('inviteLinkPlaceholder', { origin: appOrigin })}
						aria-describedby={invalid ? 'invite-link-hint invite-link-error' : 'invite-link-hint'}
						aria-invalid={invalid}
						className="text-base"
					/>
					<FieldDescription id="invite-link-hint">{t('inviteLinkHint')}</FieldDescription>
				</UiField>
				{error && invalid && <ErrorBox id="invite-link-error">{error}</ErrorBox>}
			</FieldGroup>
			<div className="flex flex-wrap items-center gap-2">
				<BackButton onClick={onBack} />
				<Button type="submit" aria-label={t('openInvite')} className="flex-1">
					<ArrowRight data-icon="inline-start" aria-hidden />
					{t('openInvite')}
				</Button>
			</div>
		</form>
	);
}

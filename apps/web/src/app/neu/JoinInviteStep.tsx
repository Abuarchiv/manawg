'use client';

import { BackButton } from '@/components/app/BackButton';
import { ErrorBox } from '@/components/app/ErrorBox';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldGroup, FieldLabel, Field as UiField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ArrowRight } from 'lucide-react';
import type { StartField } from './start-flow';

// Inlined at build time, so server and client render the same placeholder.
const INVITE_ORIGIN =
	process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://app.manawg.com';

interface JoinInviteStepProps {
	inviteLink: string;
	onInviteLinkChange: (value: string) => void;
	error: string | null;
	invalidField: StartField | null;
	clearError: () => void;
	onSubmit: () => void;
	onBack: () => void;
}

export function JoinInviteStep({
	inviteLink,
	onInviteLinkChange,
	error,
	invalidField,
	clearError,
	onSubmit,
	onBack,
}: JoinInviteStepProps) {
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
					<FieldLabel htmlFor="invite-link">Einladungslink</FieldLabel>
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
						placeholder={`${INVITE_ORIGIN}/einladung/…`}
						aria-describedby={invalid ? 'invite-link-hint invite-link-error' : 'invite-link-hint'}
						aria-invalid={invalid}
						className="text-base"
					/>
					<FieldDescription id="invite-link-hint">
						Füge den Link ein, den dir ein Mitglied der WG geschickt hat.
					</FieldDescription>
				</UiField>
				{error && invalid && <ErrorBox id="invite-link-error">{error}</ErrorBox>}
			</FieldGroup>
			<div className="flex flex-wrap items-center gap-2">
				<BackButton onClick={onBack} />
				<Button type="submit" aria-label="Einladung öffnen" className="flex-1">
					<ArrowRight data-icon="inline-start" aria-hidden />
					Einladung öffnen
				</Button>
			</div>
		</form>
	);
}

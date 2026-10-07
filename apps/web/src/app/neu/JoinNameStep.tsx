'use client';

import { BackButton } from '@/components/app/BackButton';
import { ErrorBox } from '@/components/app/ErrorBox';
import { TextField } from '@/components/app/TextField';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ArrowRight } from 'lucide-react';
import { type JoinWg, NAME_MAX, type StartField } from './start-flow';

interface JoinNameStepProps {
	joinWg: JoinWg;
	joinName: string;
	onJoinNameChange: (value: string) => void;
	error: string | null;
	invalidField: StartField | null;
	clearError: () => void;
	busy: boolean;
	onSubmit: () => void;
	onBack: () => void;
}

export function JoinNameStep({
	joinWg,
	joinName,
	onJoinNameChange,
	error,
	invalidField,
	clearError,
	busy,
	onSubmit,
	onBack,
}: JoinNameStepProps) {
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
				<TextField
					id="join-name"
					label="Dein Anzeigename"
					placeholder="z. B. Anna"
					value={joinName}
					onChange={(value) => {
						onJoinNameChange(value);
						if (error) clearError();
					}}
					maxLength={NAME_MAX}
					autoComplete="given-name"
					autoFocus
					required
					invalid={invalidField === 'joinName'}
					describedBy={invalidField === 'joinName' ? 'join-name-error' : undefined}
					enterKeyHint="done"
				/>
				{error && invalidField === 'joinName' && <ErrorBox id="join-name-error">{error}</ErrorBox>}
			</FieldGroup>
			<p className="text-sm text-muted-foreground">
				Du trittst mit dem WG-Code{' '}
				<span className="font-medium text-foreground">{joinWg.code}</span> bei.
			</p>
			{error && invalidField !== 'joinName' && (
				<ErrorBox id="join-name-form-error">{error}</ErrorBox>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<BackButton onClick={onBack} disabled={busy} />
				<Button type="submit" disabled={busy} className="flex-1">
					{busy ? (
						<Spinner data-icon="inline-start" aria-hidden />
					) : (
						<ArrowRight data-icon="inline-start" aria-hidden />
					)}
					{busy ? 'Tritt bei…' : 'WG beitreten'}
				</Button>
			</div>
		</form>
	);
}

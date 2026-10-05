'use client';

import { BackButton } from '@/components/neu/BackButton';
import { ErrorBox } from '@/components/neu/ErrorBox';
import { Field } from '@/components/neu/Field';
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
				<Field
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
			</FieldGroup>
			<p className="text-sm text-muted-foreground">
				Du trittst <span className="font-medium text-foreground">{joinWg.name}</span> bei.
			</p>
			{error && (
				<ErrorBox id={invalidField === 'joinName' ? 'join-name-error' : 'join-name-form-error'}>
					{error}
				</ErrorBox>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<BackButton onClick={onBack} disabled={busy} />
				<Button
					type="submit"
					disabled={busy}
					aria-label={busy ? 'Du trittst der WG bei…' : 'WG beitreten'}
					className="flex-1"
				>
					{busy ? (
						<Spinner data-icon="inline-start" aria-hidden />
					) : (
						<ArrowRight data-icon="inline-start" aria-hidden />
					)}
					{busy ? 'Tritt bei…' : 'Beitreten'}
				</Button>
			</div>
		</form>
	);
}

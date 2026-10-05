'use client';

import { BackButton } from '@/components/neu/BackButton';
import { ErrorBox } from '@/components/neu/ErrorBox';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldGroup, FieldLabel, Field as UiField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ArrowRight } from 'lucide-react';
import type { StartField } from './start-flow';

interface JoinCodeStepProps {
	joinCode: string;
	onJoinCodeChange: (value: string) => void;
	error: string | null;
	invalidField: StartField | null;
	clearError: () => void;
	busy: boolean;
	onSubmit: () => void;
	onBack: () => void;
}

export function JoinCodeStep({
	joinCode,
	onJoinCodeChange,
	error,
	invalidField,
	clearError,
	busy,
	onSubmit,
	onBack,
}: JoinCodeStepProps) {
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
				<UiField data-invalid={invalidField === 'joinCode'}>
					<FieldLabel htmlFor="join-code">WG-Code</FieldLabel>
					<Input
						id="join-code"
						type="text"
						value={joinCode}
						onChange={(event) => {
							// Pasted codes often carry spaces or dashes ("ABCD 1234"); drop them (and
							// leave maxLength slack) so a paste is not cut off.
							onJoinCodeChange(
								event.target.value
									.replace(/[^a-z0-9]/gi, '')
									.toUpperCase()
									.slice(0, 8),
							);
							if (error) clearError();
						}}
						maxLength={16}
						required
						autoFocus
						autoComplete="off"
						autoCapitalize="characters"
						inputMode="text"
						enterKeyHint="done"
						placeholder="ABCD1234"
						aria-describedby={
							invalidField === 'joinCode' ? 'join-code-hint join-code-error' : 'join-code-hint'
						}
						aria-invalid={invalidField === 'joinCode'}
						className="font-mono text-base"
					/>
					<FieldDescription id="join-code-hint">8 Zeichen, ohne I, L, O und U.</FieldDescription>
				</UiField>
			</FieldGroup>
			{error && (
				<ErrorBox id={invalidField === 'joinCode' ? 'join-code-error' : 'join-code-form-error'}>
					{error}
				</ErrorBox>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<BackButton onClick={onBack} disabled={busy} />
				<Button
					type="submit"
					disabled={busy}
					aria-label={busy ? 'WG-Code wird geprüft…' : 'WG-Code prüfen'}
					className="flex-1"
				>
					{busy ? (
						<Spinner data-icon="inline-start" aria-hidden />
					) : (
						<ArrowRight data-icon="inline-start" aria-hidden />
					)}
					{busy ? 'Wird geprüft…' : 'Code prüfen'}
				</Button>
			</div>
		</form>
	);
}

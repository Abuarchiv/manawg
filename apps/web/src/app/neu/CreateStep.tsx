'use client';

import { BackButton } from '@/components/app/BackButton';
import { ErrorBox } from '@/components/app/ErrorBox';
import { TextField } from '@/components/app/TextField';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ArrowRight } from 'lucide-react';
import { NAME_MAX, type StartField, WG_NAME_MAX } from './start-flow';

interface CreateStepProps {
	wgName: string;
	onWgNameChange: (value: string) => void;
	creatorName: string;
	onCreatorNameChange: (value: string) => void;
	error: string | null;
	invalidField: StartField | null;
	busy: boolean;
	onSubmit: () => void;
	onBack: () => void;
}

export function CreateStep({
	wgName,
	onWgNameChange,
	creatorName,
	onCreatorNameChange,
	error,
	invalidField,
	busy,
	onSubmit,
	onBack,
}: CreateStepProps) {
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
					id="wg-name"
					label="WG-Name"
					placeholder="z. B. WG Weserstraße"
					value={wgName}
					onChange={onWgNameChange}
					maxLength={WG_NAME_MAX}
					autoComplete="organization"
					autoFocus
					required
					invalid={invalidField === 'wgName'}
					describedBy={invalidField === 'wgName' ? 'create-wg-error' : undefined}
					enterKeyHint="next"
				/>
				<TextField
					id="creator-name"
					label="Dein Anzeigename"
					placeholder="z. B. Anna"
					value={creatorName}
					onChange={onCreatorNameChange}
					maxLength={NAME_MAX}
					autoComplete="given-name"
					required
					invalid={invalidField === 'creatorName'}
					describedBy={invalidField === 'creatorName' ? 'create-wg-error' : undefined}
					enterKeyHint="done"
				/>
			</FieldGroup>
			{error && (
				<ErrorBox
					id={
						invalidField === 'wgName' || invalidField === 'creatorName'
							? 'create-wg-error'
							: 'create-wg-form-error'
					}
				>
					{error}
				</ErrorBox>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<BackButton onClick={onBack} disabled={busy} />
				<Button
					type="submit"
					disabled={busy}
					aria-label={busy ? 'WG wird erstellt…' : 'WG erstellen'}
					className="flex-1"
				>
					{busy ? (
						<Spinner data-icon="inline-start" aria-hidden />
					) : (
						<ArrowRight data-icon="inline-start" aria-hidden />
					)}
					{busy ? 'Wird erstellt…' : 'WG erstellen'}
				</Button>
			</div>
		</form>
	);
}

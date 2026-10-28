'use client';

import { BackButton } from '@/components/app/BackButton';
import { ErrorBox } from '@/components/app/ErrorBox';
import { TextField } from '@/components/app/TextField';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NAME_MAX, type StartField, WG_NAME_MAX } from './start-flow';

interface CreateStepProps {
	wgName: string;
	onWgNameChange: (value: string) => void;
	creatorName: string;
	onCreatorNameChange: (value: string) => void;
	error: string | null;
	invalidField: StartField | null;
	clearError: () => void;
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
	clearError,
	busy,
	onSubmit,
	onBack,
}: CreateStepProps) {
	const t = useTranslations('entry.start');
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
					label={t('flatName')}
					placeholder={t('flatNamePlaceholder')}
					value={wgName}
					onChange={(value) => {
						if (error) clearError();
						onWgNameChange(value);
					}}
					maxLength={WG_NAME_MAX}
					autoComplete="organization"
					autoFocus
					required
					invalid={invalidField === 'wgName'}
					describedBy={invalidField === 'wgName' ? 'create-wg-error' : undefined}
					enterKeyHint="next"
				/>
				{error && invalidField === 'wgName' && <ErrorBox id="create-wg-error">{error}</ErrorBox>}
				<TextField
					id="creator-name"
					label={t('displayName')}
					placeholder={t('displayNamePlaceholder')}
					value={creatorName}
					onChange={(value) => {
						if (error) clearError();
						onCreatorNameChange(value);
					}}
					maxLength={NAME_MAX}
					autoComplete="given-name"
					required
					invalid={invalidField === 'creatorName'}
					describedBy={invalidField === 'creatorName' ? 'create-wg-error' : undefined}
					enterKeyHint="done"
				/>
				{error && invalidField === 'creatorName' && (
					<ErrorBox id="create-wg-error">{error}</ErrorBox>
				)}
			</FieldGroup>
			{error && invalidField !== 'wgName' && invalidField !== 'creatorName' && (
				<ErrorBox id="create-wg-form-error">{error}</ErrorBox>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<BackButton onClick={onBack} disabled={busy} />
				<Button type="submit" disabled={busy} className="flex-1">
					{busy ? (
						<Spinner data-icon="inline-start" aria-hidden />
					) : (
						<ArrowRight data-icon="inline-start" aria-hidden />
					)}
					{busy ? t('creating') : t('create')}
				</Button>
			</div>
		</form>
	);
}

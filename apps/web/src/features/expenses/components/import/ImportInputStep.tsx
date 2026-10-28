'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, type Ref, useEffect, useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/shared/lib/cn';
import type { ImportSourceKind } from './ImportSourcePicker';
import { ImportStepHeading } from './ImportStepHeading';
import type { ImportInput } from './use-import-input';

/** The native file input stays invisible in the DOM; the button is its label so it looks like any other. */
function FilePickLabel({
	htmlFor,
	fallback,
	name,
}: {
	htmlFor: string;
	fallback: string;
	name: string | null;
}) {
	return (
		<label
			htmlFor={htmlFor}
			className={cn(
				buttonVariants({ variant: 'outline' }),
				'w-full cursor-pointer peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:pointer-events-none peer-disabled:opacity-50',
			)}
		>
			<span className="min-w-0 truncate">{name ?? fallback}</span>
		</label>
	);
}

function ManualInput({
	summary,
	id,
	label,
	placeholder,
	value,
	invalid,
	disabled,
	onChange,
	openWhen = false,
}: {
	summary: string;
	id: string;
	label: string;
	placeholder: string;
	value: string;
	invalid: boolean;
	disabled: boolean;
	onChange: (value: string) => void;
	/** Expands once when the condition becomes true (e.g. OCR result ready); collapsing stays possible. */
	openWhen?: boolean;
}) {
	const detailsRef = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		if (openWhen && detailsRef.current) detailsRef.current.open = true;
	}, [openWhen]);
	return (
		<details ref={detailsRef}>
			<summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium [&::-webkit-details-marker]:hidden">
				<ChevronDown className="size-4" aria-hidden />
				{summary}
			</summary>
			<div className="pt-2">
				<Field data-invalid={invalid} data-disabled={disabled}>
					<FieldLabel htmlFor={id}>{label}</FieldLabel>
					<Textarea
						id={id}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						disabled={disabled}
						aria-label={label}
						aria-invalid={invalid || undefined}
						aria-describedby={invalid ? 'import-error' : undefined}
						placeholder={placeholder}
						className="min-h-32 text-base"
					/>
				</Field>
			</div>
		</details>
	);
}

function FilePick({
	id,
	accept,
	ariaLabel,
	fallback,
	name,
	disabled,
	onFile,
	children,
}: {
	id: string;
	accept: string;
	ariaLabel: string;
	fallback: string;
	name: string | null;
	disabled: boolean;
	onFile: (file: File) => void;
	children: ReactNode;
}) {
	return (
		<Field className="relative" data-disabled={disabled}>
			<Input
				id={id}
				type="file"
				accept={accept}
				aria-label={ariaLabel}
				disabled={disabled}
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) onFile(file);
					// The same file must be selectable again after a rejection.
					event.target.value = '';
				}}
				className="peer sr-only h-px w-px"
			/>
			<FilePickLabel htmlFor={id} fallback={fallback} name={name} />
			<FieldDescription>{children}</FieldDescription>
		</Field>
	);
}

interface ImportInputStepProps {
	headingRef: Ref<HTMLHeadingElement>;
	source: ImportSourceKind;
	input: ImportInput;
	busy: boolean;
	onPreview: () => void;
	onBack: () => void;
}

export function ImportInputStep({
	headingRef,
	source,
	input,
	busy,
	onPreview,
	onBack,
}: ImportInputStepProps) {
	const t = useTranslations('expenses-import');
	const { ocrRunning, inputStatus } = input;
	const invalid = inputStatus === 'error';
	return (
		<section className="flex flex-col gap-4">
			<ImportStepHeading headingRef={headingRef}>
				{source === 'ocr_screenshot' ? t('input.headingImage') : t('input.headingFile')}
			</ImportStepHeading>
			<FieldGroup>
				{source === 'ocr_screenshot' ? (
					<>
						<FilePick
							id="import-screenshot"
							accept="image/*"
							ariaLabel={t('input.screenshot.ariaLabel')}
							fallback={t('input.screenshot.fallback')}
							name={input.pickedFileName}
							disabled={busy || ocrRunning}
							onFile={(file) => void input.handleOcrFile(file)}
						>
							{t('input.screenshot.hint')}
						</FilePick>
						{ocrRunning && (
							<Alert>
								<Spinner />
								<AlertDescription>{t('input.screenshot.running')}</AlertDescription>
							</Alert>
						)}
						<ManualInput
							summary={t('input.screenshot.summary')}
							id="import-ocr"
							label={t('input.screenshot.label')}
							placeholder={t('input.screenshot.placeholder')}
							value={input.ocrText}
							invalid={invalid && input.ocrText.length > 0}
							disabled={busy || ocrRunning}
							onChange={input.setManualPayload}
							openWhen={input.ocrText.length > 0}
						/>
					</>
				) : (
					<>
						<FilePick
							id="import-csv-file"
							accept=".csv,text/csv"
							ariaLabel={t('input.csv.ariaLabel')}
							fallback={t('input.csv.fallback')}
							name={input.pickedFileName}
							disabled={busy || inputStatus === 'reading'}
							onFile={input.handleCsvFile}
						>
							{t('input.csv.hint')}
						</FilePick>
						<ManualInput
							summary={t('input.csv.summary')}
							id="import-csv-textarea"
							label={t('input.csv.label')}
							placeholder={t('input.csv.placeholder')}
							value={input.rawPayload}
							invalid={invalid && input.rawPayload.length > 0}
							disabled={busy || inputStatus === 'reading'}
							onChange={input.setManualPayload}
						/>
					</>
				)}
			</FieldGroup>
			<div className="flex min-w-0 flex-wrap gap-2">
				<Button
					className="flex-1"
					disabled={
						busy || ocrRunning || inputStatus !== 'ready' || input.rawPayload.trim().length === 0
					}
					onClick={onPreview}
				>
					{busy && <Spinner data-icon="inline-start" />}
					{t('actions.createPreview')}
				</Button>
				<Button variant="outline" disabled={busy || ocrRunning} onClick={onBack}>
					{t('actions.back')}
				</Button>
			</div>
		</section>
	);
}

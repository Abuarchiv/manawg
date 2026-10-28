'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PRIVATE_IMAGE_MIME_TYPES } from '@/core/infra/private-image-policy';
import { isPendingImageToken } from '@/core/offline/offline-images';
import { type Message, useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import { AlertTriangle, ImagePlus, Maximize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ImagePreviewDialog } from './ImagePreviewDialog';
import { MAX_UPLOAD_MB, useImageUpload } from './use-image-upload';

interface Props {
	shareCode: string;
	purpose: 'expense' | 'announcement';
	value: string | null;
	onChange: (url: string | null) => void;
	disabled?: boolean;
	imageLabel?: string;
	/** True while a file is being prepared or uploaded, so the form can hold its submit. */
	onUploadingChange?: (uploading: boolean) => void;
}

function UploadFeedback({ error, notice }: { error: Message | null; notice: Message | null }) {
	const message = useMessage();
	return (
		<>
			{error && (
				<Alert variant="destructive" className="mt-2">
					<AlertDescription className="text-current">{message(error)}</AlertDescription>
				</Alert>
			)}
			{notice && (
				<output className="mt-2 block text-meta text-muted-foreground" aria-live="polite">
					{message(notice)}
				</output>
			)}
		</>
	);
}

export function ImageUploader({
	shareCode,
	purpose,
	value,
	onChange,
	disabled = false,
	imageLabel,
	onUploadingChange,
}: Props) {
	const t = useTranslations('shell.upload');
	const { uploading, error, notice, featureDisabled, localPreview, handleFile, remove } =
		useImageUpload({ shareCode, purpose, value, onChange, disabled });
	const onUploadingChangeRef = useRef(onUploadingChange);
	onUploadingChangeRef.current = onUploadingChange;
	useEffect(() => {
		onUploadingChangeRef.current?.(uploading);
	}, [uploading]);
	// A closed form must not stay blocked by an upload it does not show.
	useEffect(() => () => onUploadingChangeRef.current?.(false), []);
	const [previewOpen, setPreviewOpen] = useState(false);
	const accessibleImageLabel =
		imageLabel ?? (purpose === 'expense' ? t('receiptImage') : t('postImage'));

	if (value) {
		const pending = isPendingImageToken(value);
		const previewSrc = pending ? localPreview : value;
		return (
			<>
				<div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-border bg-card">
					{previewSrc ? (
						<img
							src={previewSrc}
							alt={
								pending
									? t('altPrepared', { label: accessibleImageLabel })
									: t('altUploaded', { label: accessibleImageLabel })
							}
							className="h-full w-full object-cover"
							loading="lazy"
						/>
					) : (
						<div className="flex h-full items-center justify-center text-meta text-muted-foreground">
							{t('preparing')}
						</div>
					)}
					{pending && (
						<Badge
							variant="secondary"
							className="absolute left-2 top-2 bg-background/90 text-foreground"
						>
							{t('offlineReady')}
						</Badge>
					)}
					<div className="absolute right-2 top-2 flex gap-1.5">
						<Button
							variant="secondary"
							size="icon-lg"
							type="button"
							onClick={() => setPreviewOpen(true)}
							aria-label={t('enlarge', { label: accessibleImageLabel })}
							disabled={!previewSrc}
						>
							<Maximize2 aria-hidden />
						</Button>
						<Button
							variant="secondary"
							size="icon-lg"
							type="button"
							onClick={remove}
							aria-label={t('removeImage', { label: accessibleImageLabel })}
							disabled={disabled || uploading}
						>
							<X aria-hidden />
						</Button>
					</div>
				</div>
				{previewOpen && previewSrc && (
					<ImagePreviewDialog
						src={previewSrc}
						label={accessibleImageLabel}
						onClose={() => setPreviewOpen(false)}
					/>
				)}
				<UploadFeedback error={error} notice={notice} />
			</>
		);
	}

	if (featureDisabled) {
		return (
			<Alert>
				<AlertTriangle aria-hidden />
				<AlertDescription>{t('notConfigured')}</AlertDescription>
			</Alert>
		);
	}

	return (
		<div>
			<label
				className={cn(
					'flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg px-3 py-3 border-2 border-dashed border-border bg-background text-sm text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-ring/50',
					disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50',
				)}
			>
				{uploading ? (
					<Spinner className="size-6" aria-hidden="true" />
				) : (
					<ImagePlus className="size-6" aria-hidden="true" />
				)}
				<span aria-live="polite">{uploading ? t('uploading') : t('addImage')}</span>
				<span className="text-center text-xs text-muted-foreground">
					{t('formats', { max: String(MAX_UPLOAD_MB) })}
				</span>
				<input
					type="file"
					accept={PRIVATE_IMAGE_MIME_TYPES.join(',')}
					className="sr-only"
					aria-label={t('chooseLabel')}
					disabled={disabled || uploading}
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) void handleFile(file);
						e.currentTarget.value = '';
					}}
				/>
			</label>
			<UploadFeedback error={error} notice={notice} />
		</div>
	);
}

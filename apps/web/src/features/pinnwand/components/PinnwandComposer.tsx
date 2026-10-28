'use client';
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/components/ui/drawer';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ImageUploader } from '@/components/wg/ImageUploader';
import { ANNOUNCEMENT_KINDS } from '@/features/pinnwand/announcement-workflow';
import type { AnnouncementKind } from '@/features/pinnwand/components/announcement-types';
import { CONTENT_MAX } from '@/features/pinnwand/constants';
import { type Message, useMessage } from '@/shared/i18n/message';
import { ChevronDown, ImagePlus, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactElement, type RefObject, useState } from 'react';

interface PinnwandComposerProps {
	open: boolean;
	/** Trigger to which focus returns after closing. */
	finalFocusRef: RefObject<HTMLElement | null>;
	authorName: string;
	submitting: boolean;
	kind: AnnouncementKind;
	onKindChange: (kind: AnnouncementKind) => void;
	content: string;
	onContentChange: (value: string) => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	imageUrl: string | null;
	onImageUrlChange: (value: string | null) => void;
	shareCode: string;
	error: Message | null;
	onClose: () => void;
	onSubmit: () => void;
}

export function PinnwandComposer({
	open,
	finalFocusRef,
	authorName,
	submitting,
	kind,
	onKindChange,
	content,
	onContentChange,
	textareaRef,
	imageUrl,
	onImageUrlChange,
	shareCode,
	error,
	onClose,
	onSubmit,
}: PinnwandComposerProps): ReactElement {
	const t = useTranslations('pinnwand');
	const render = useMessage();
	const fieldInvalid = Boolean(error) && (content.trim() === '' || content.length > CONTENT_MAX);
	const [attachmentOpen, setAttachmentOpen] = useState(Boolean(imageUrl));
	// Posting while the image still uploads would publish the post without it.
	const [imageUploading, setImageUploading] = useState(false);
	return (
		<Drawer
			open={open}
			onOpenChange={(next) => {
				if (!next && !submitting) onClose();
			}}
		>
			<DrawerContent
				className="mx-auto w-full max-w-md"
				initialFocus={textareaRef}
				finalFocus={finalFocusRef}
				aria-busy={submitting}
			>
				<DrawerHeader>
					<DrawerTitle>{t('composer.title')}</DrawerTitle>
					<DrawerDescription className="sr-only">{t('composer.description')}</DrawerDescription>
				</DrawerHeader>
				<div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
					<FieldGroup>
						<Field>
							<FieldLabel id="announcement-kind-label" className="sr-only">
								{t('composer.kindLabel')}
							</FieldLabel>
							<ToggleGroup
								value={[kind]}
								onValueChange={(values) => {
									const selected = ANNOUNCEMENT_KINDS.find((option) => option === values[0]);
									if (selected) onKindChange(selected);
								}}
								disabled={submitting}
								spacing={1}
								variant="outline"
								className="flex-wrap"
								aria-labelledby="announcement-kind-label"
							>
								{ANNOUNCEMENT_KINDS.map((option) => (
									<ToggleGroupItem key={option} value={option} className="px-2">
										{t(`kind.${option}`)}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
						</Field>
						<Field data-invalid={fieldInvalid} className="data-[invalid=true]:text-foreground">
							<FieldLabel htmlFor="announcement-content" className="sr-only">
								{t('composer.textLabel')}
							</FieldLabel>
							<Textarea
								ref={textareaRef}
								id="announcement-content"
								value={content}
								onChange={(e) => onContentChange(e.target.value)}
								readOnly={submitting}
								aria-busy={submitting}
								maxLength={CONTENT_MAX}
								rows={3}
								aria-invalid={fieldInvalid}
								aria-describedby={error ? 'announcement-error' : 'announcement-count'}
								placeholder={t('composer.placeholder', { name: authorName })}
								className="min-h-20 text-base read-only:opacity-60"
							/>
						</Field>
					</FieldGroup>
					<Collapsible open={attachmentOpen || Boolean(imageUrl)} onOpenChange={setAttachmentOpen}>
						<CollapsibleTrigger render={<Button variant="outline" />} disabled={submitting}>
							<ImagePlus data-icon="inline-start" aria-hidden />
							{imageUrl ? t('composer.attached') : t('composer.attach')}
							<ChevronDown data-icon="inline-end" aria-hidden />
						</CollapsibleTrigger>
						<CollapsiblePanel keepRendered inert={!attachmentOpen && !imageUrl}>
							<div className="pt-3">
								<ImageUploader
									shareCode={shareCode}
									purpose="announcement"
									value={imageUrl}
									onChange={onImageUrlChange}
									disabled={submitting}
									imageLabel={t('composer.imageLabel')}
									onUploadingChange={setImageUploading}
								/>
							</div>
						</CollapsiblePanel>
					</Collapsible>
					{error && (
						<Alert id="announcement-error" variant="destructive">
							<AlertDescription>{render(error)}</AlertDescription>
						</Alert>
					)}
				</div>
				<DrawerFooter className="border-t pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
					<span
						id="announcement-count"
						className={`self-end text-xs tabular-nums text-muted-foreground ${content.length < CONTENT_MAX * 0.8 ? 'sr-only' : ''}`}
					>
						{content.length}/{CONTENT_MAX}
					</span>
					<Button
						type="button"
						className="w-full"
						onClick={onSubmit}
						disabled={submitting || imageUploading || content.trim().length === 0}
					>
						{submitting ? (
							<Spinner data-icon="inline-start" aria-hidden />
						) : (
							<Send data-icon="inline-start" aria-hidden />
						)}
						{submitting ? t('composer.posting') : t('composer.post')}
					</Button>
					<Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
						{t('composer.cancel')}
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}

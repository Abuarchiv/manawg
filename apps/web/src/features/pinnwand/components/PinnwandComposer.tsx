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
import type { AnnouncementKind } from '@/features/pinnwand/components/announcement-types';
import { KIND_OPTIONS } from '@/features/pinnwand/components/constants';
import { CONTENT_MAX } from '@/features/pinnwand/constants';
import { ChevronDown, ImagePlus, Send } from 'lucide-react';
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
	error: string | null;
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
					<DrawerTitle>Neuer Beitrag</DrawerTitle>
					<DrawerDescription className="sr-only">
						Frage, Info oder Problem für eure WG teilen.
					</DrawerDescription>
				</DrawerHeader>
				<div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
					<FieldGroup>
						<Field>
							<FieldLabel id="announcement-kind-label" className="sr-only">
								Beitragstyp
							</FieldLabel>
							<ToggleGroup
								value={[kind]}
								onValueChange={(values) => {
									const selected = KIND_OPTIONS.find((option) => option.value === values[0]);
									if (selected) onKindChange(selected.value);
								}}
								disabled={submitting}
								spacing={1}
								variant="outline"
								className="flex-wrap"
								aria-labelledby="announcement-kind-label"
							>
								{KIND_OPTIONS.map((option) => (
									<ToggleGroupItem key={option.value} value={option.value} className="px-2">
										{option.label}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
						</Field>
						<Field data-invalid={fieldInvalid} className="data-[invalid=true]:text-foreground">
							<FieldLabel htmlFor="announcement-content" className="sr-only">
								Beitragstext
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
								placeholder={`Was gibt es Neues, ${authorName}?`}
								className="min-h-20 text-base read-only:opacity-60"
							/>
						</Field>
					</FieldGroup>
					<Collapsible open={attachmentOpen || Boolean(imageUrl)} onOpenChange={setAttachmentOpen}>
						<CollapsibleTrigger render={<Button variant="outline" />} disabled={submitting}>
							<ImagePlus data-icon="inline-start" aria-hidden />
							{imageUrl ? 'Bild angehängt' : 'Bild anhängen'}
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
									imageLabel="Beitragsbild"
									onUploadingChange={setImageUploading}
								/>
							</div>
						</CollapsiblePanel>
					</Collapsible>
					{error && (
						<Alert id="announcement-error" variant="destructive">
							<AlertDescription>{error}</AlertDescription>
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
						{submitting ? 'Postet…' : 'Posten'}
					</Button>
					<Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
						Abbrechen
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}

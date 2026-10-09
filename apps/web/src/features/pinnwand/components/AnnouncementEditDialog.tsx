'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useRef, useState } from 'react';

const CONTENT_MAX = 2000;

interface AnnouncementEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialContent: string;
	/** null = saved, otherwise the error message for the dialog. */
	onSave: (content: string) => Promise<string | null>;
}

/** Edit the text of a manual post; stays open with the error on failure. */
export function AnnouncementEditDialog({
	open,
	onOpenChange,
	initialContent,
	onSave,
}: AnnouncementEditDialogProps) {
	const [content, setContent] = useState(initialContent);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Every opening starts from the current text, without the previous attempt's error; a
	// background refresh while the dialog is open must not replace what is being typed.
	const wasOpenRef = useRef(false);
	useEffect(() => {
		if (open && !wasOpenRef.current) {
			setContent(initialContent);
			setError(null);
		}
		wasOpenRef.current = open;
	}, [open, initialContent]);
	const trimmed = content.trim();
	const unchanged = trimmed === initialContent.trim();

	async function save(): Promise<void> {
		if (saving || trimmed.length === 0 || unchanged) return;
		setSaving(true);
		setError(null);
		const failure = await onSave(trimmed);
		setSaving(false);
		if (failure) setError(failure);
		else onOpenChange(false);
	}

	return (
		<Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
			<DialogContent>
				<form
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
					className="flex flex-col gap-4"
				>
					<DialogHeader>
						<DialogTitle>Beitrag bearbeiten</DialogTitle>
						<DialogDescription>Der Text ersetzt den bisherigen Beitrag.</DialogDescription>
					</DialogHeader>
					<Field data-invalid={Boolean(error)}>
						<FieldLabel htmlFor="announcement-edit-content">Text</FieldLabel>
						<Textarea
							id="announcement-edit-content"
							value={content}
							onChange={(event) => {
								setContent(event.target.value);
								setError(null);
							}}
							maxLength={CONTENT_MAX}
							rows={5}
							disabled={saving}
							aria-invalid={Boolean(error) || undefined}
							aria-describedby={error ? 'announcement-edit-error' : undefined}
							className="text-base"
						/>
					</Field>
					{error && (
						<Alert variant="destructive">
							<AlertDescription id="announcement-edit-error">{error}</AlertDescription>
						</Alert>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={saving}
							className="min-h-11"
							onClick={() => onOpenChange(false)}
						>
							Abbrechen
						</Button>
						<Button
							type="submit"
							disabled={saving || trimmed.length === 0 || unchanged}
							className="min-h-11"
						>
							{saving && <Spinner data-icon="inline-start" aria-hidden />}
							Speichern
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

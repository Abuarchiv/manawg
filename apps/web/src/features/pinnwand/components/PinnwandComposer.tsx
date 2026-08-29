'use client';
import { ALERT_DANGER } from '@/components/ui/styles';
import { ImageUploader } from '@/components/wg/ImageUploader';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import type { AnnouncementKind } from '@/features/pinnwand/components/announcement-types';
import { CONTENT_MAX, KIND_OPTIONS } from '@/features/pinnwand/components/constants';
import { Loader2, Send, X } from 'lucide-react';
import type React from 'react';

interface PinnwandComposerProps {
	authorName: string;
	authorColor: string | null;
	submitting: boolean;
	kind: AnnouncementKind;
	onKindChange: (kind: AnnouncementKind) => void;
	content: string;
	onContentChange: (value: string) => void;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
	imageUrl: string | null;
	onImageUrlChange: (value: string | null) => void;
	shareCode: string;
	error: string | null;
	onClose: () => void;
	onSubmit: () => void;
}

export function PinnwandComposer({
	authorName,
	authorColor,
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
}: PinnwandComposerProps): React.ReactElement {
	return (
		<section
			id="announcement-composer"
			className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4 sm:p-5"
		>
			<div className="flex items-start gap-3">
				<MemberAvatar name={authorName} color={authorColor} size={32} />
				<div className="min-w-0 flex-1">
					<div className="text-[13px] font-semibold text-[var(--text-1)]">{authorName}</div>
					<div className="text-[12px] text-[var(--text-3)]">Neuer Beitrag</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					disabled={submitting}
					className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					aria-label="Beitrag abbrechen"
				>
					<X className="h-4 w-4" aria-hidden />
				</button>
			</div>
			{/* biome-ignore lint/a11y/useSemanticElements: button toolbar group; <fieldset> would change layout semantics */}
			<div className="flex flex-wrap gap-1.5" role="group" aria-label="Beitragstyp">
				{KIND_OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						onClick={() => onKindChange(option.value)}
						disabled={submitting}
						aria-pressed={kind === option.value}
						className={`inline-flex h-11 items-center rounded-md border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
							kind === option.value
								? 'border-[var(--text-1)] bg-[var(--text-1)] text-[var(--bg-base)]'
								: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
						}`}
					>
						{option.label}
					</button>
				))}
			</div>
			<textarea
				ref={textareaRef}
				id="announcement-content"
				value={content}
				onChange={(e) => onContentChange(e.target.value)}
				disabled={submitting}
				maxLength={CONTENT_MAX}
				rows={4}
				aria-label="Beitragstext"
				placeholder={`Was gibt es Neues, ${authorName}?`}
				className="block min-h-[110px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3.5 py-2.5 text-[15px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
			/>
			<ImageUploader
				shareCode={shareCode}
				purpose="announcement"
				value={imageUrl}
				onChange={onImageUrlChange}
				disabled={submitting}
				imageLabel="Beitragsbild"
			/>
			{error && (
				<p role="alert" className={ALERT_DANGER}>
					{error}
				</p>
			)}
			<div className="flex items-center justify-between pt-1">
				<span
					className={`text-[12px] tabular-nums transition-colors ${
						content.length > CONTENT_MAX * 0.9 ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'
					}`}
				>
					{content.length}/{CONTENT_MAX}
				</span>
				<button
					type="button"
					onClick={onSubmit}
					disabled={submitting || content.trim().length === 0}
					className="inline-flex h-11 items-center gap-1.5 rounded-md bg-[var(--text-1)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{submitting ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
					) : (
						<Send className="h-3.5 w-3.5" aria-hidden />
					)}
					Posten
				</button>
			</div>
		</section>
	);
}

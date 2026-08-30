'use client';

import { haptic } from '@/shared/lib/haptics';
import { Image as ImageIcon, Loader2, Send, X } from 'lucide-react';
import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
	MentionAutocomplete,
	type MentionMember,
	filterMentionMembers,
	mentionOptionId,
} from './MentionAutocomplete';

const BODY_MAX = 4000;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ChatComposerProps {
	members: MentionMember[];
	currentMemberId: string;
	replyToMessageId: string | null;
	replyToPreview: string | null;
	replyToSenderName: string | null;
	onClearReply: () => void;
	onSend: (input: {
		body: string;
		mentionMemberIds: string[];
		replyToMessageId: string | null;
	}) => Promise<boolean>;
	onPickImage?: () => void;
}

interface MentionTrigger {
	query: string;
	startIndex: number;
}

function detectMention(value: string, cursor: number): MentionTrigger | null {
	const upTo = value.slice(0, cursor);
	const match = /(?:^|\s)@([A-Za-zÄÖÜäöüß0-9_-]{0,40})$/.exec(upTo);
	if (!match) return null;
	const start = upTo.length - (match[1]?.length ?? 0) - 1;
	return { query: match[1] ?? '', startIndex: start };
}

export function ChatComposer({
	members,
	currentMemberId,
	replyToMessageId,
	replyToPreview,
	replyToSenderName,
	onClearReply,
	onSend,
	onPickImage,
}: ChatComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [draft, setDraft] = useState('');
	const [pending, setPending] = useState(false);
	const [mention, setMention] = useState<MentionTrigger | null>(null);
	const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
	const mentionListboxId = 'mention-listbox';
	const visibleMembers = useMemo(
		() => members.filter((m) => m.id !== currentMemberId),
		[members, currentMemberId],
	);

	const mentionItems = useMemo(
		() => (mention === null ? [] : filterMentionMembers(visibleMembers, mention.query)),
		[mention, visibleMembers],
	);
	const mentionOpen = mentionItems.length > 0;
	const activeOptionId = mentionOpen
		? mentionOptionId(mentionListboxId, mentionActiveIndex)
		: undefined;

	// biome-ignore lint/correctness/useExhaustiveDependencies: mentionItems identity change is the correct trigger
	useEffect(() => {
		setMentionActiveIndex(0);
	}, [mentionItems]);

	function handleChange(e: ChangeEvent<HTMLTextAreaElement>): void {
		const value = e.target.value;
		setDraft(value);
		const cursor = e.target.selectionStart ?? value.length;
		setMention(detectMention(value, cursor));
	}

	function insertMention(member: MentionMember): void {
		if (!mention || !textareaRef.current) return;
		const value = textareaRef.current.value;
		const before = value.slice(0, mention.startIndex);
		const after = value.slice(mention.startIndex + 1 + mention.query.length);
		const insertion = `@${member.name} `;
		const next = `${before}${insertion}${after}`;
		setDraft(next);
		setMention(null);
		const nextCursor = before.length + insertion.length;
		queueMicrotask(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(nextCursor, nextCursor);
		});
	}

	async function submit(): Promise<void> {
		const text = draft.trim();
		if (text.length === 0 || pending) return;
		haptic('selection');
		setPending(true);
		// Trailing `\b` misses names ending in a diacritic (e.g. "René"): `\b` only
		// matches at a word/non-word transition, and JS regex `\w` is ASCII-only, so
		// a non-ASCII trailing letter followed by a space/end never satisfies it.
		// A negative lookahead against `\p{L}\p{N}_-` (any Unicode letter/digit, not
		// just the enumerated German charset) avoids matching a longer name that
		// merely starts with this one — e.g. "@René" must not also match member "Ren".
		const mentionedIds = visibleMembers
			.filter((m) => new RegExp(`@${escapeRegExp(m.name)}(?![\\p{L}\\p{N}_-])`, 'u').test(text))
			.map((m) => m.id);
		try {
			const ok = await onSend({
				body: text,
				mentionMemberIds: mentionedIds,
				replyToMessageId,
			});
			if (ok) {
				haptic('medium');
				setDraft('');
				setMention(null);
				onClearReply();
			}
		} finally {
			setPending(false);
		}
	}

	function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
		if (mentionOpen) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setMentionActiveIndex((current) => (current + 1) % mentionItems.length);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setMentionActiveIndex((current) => (current === 0 ? mentionItems.length - 1 : current - 1));
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				const target = mentionItems[mentionActiveIndex];
				if (target) insertMention(target);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				setMention(null);
				return;
			}
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void submit();
		}
	}

	return (
		<div
			className="sticky bottom-0 z-20 border-t border-[var(--border)] bg-[var(--bg-base)]"
			style={{ paddingBottom: 'env(keyboard-inset-height, 0px)' }}
		>
			{replyToMessageId && (
				<div className="flex items-start gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px]">
					<div className="min-w-0 flex-1">
						<div className="font-medium text-[var(--text-2)]">
							Antwort an {replyToSenderName ?? 'Unbekannt'}
						</div>
						<div className="truncate text-[var(--text-3)]">{replyToPreview ?? '…'}</div>
					</div>
					<button
						type="button"
						onClick={onClearReply}
						aria-label="Antwort abbrechen"
						className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						<X className="h-3.5 w-3.5" aria-hidden />
					</button>
				</div>
			)}
			<MentionAutocomplete
				listboxId={mentionListboxId}
				items={mentionItems}
				activeIndex={mentionActiveIndex}
				onSelect={insertMention}
				onHoverIndex={setMentionActiveIndex}
			/>
			<div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-3 py-2 sm:px-4">
				{onPickImage && (
					<button
						type="button"
						onClick={onPickImage}
						aria-label="Bild hinzufügen"
						className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						<ImageIcon className="h-4 w-4" aria-hidden />
					</button>
				)}
				<textarea
					ref={textareaRef}
					value={draft}
					onChange={handleChange}
					onKeyDown={onKey}
					placeholder="Nachricht schreiben"
					maxLength={BODY_MAX}
					rows={1}
					aria-label="Chat-Nachricht"
					aria-autocomplete="list"
					aria-controls={mentionOpen ? mentionListboxId : undefined}
					aria-expanded={mentionOpen}
					aria-activedescendant={activeOptionId}
					className="max-h-40 min-h-[44px] flex-1 resize-y rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[16px] text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				/>
				<button
					type="button"
					onClick={() => void submit()}
					disabled={pending || draft.trim().length === 0}
					aria-label="Nachricht senden"
					className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{pending ? (
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
					) : (
						<Send className="h-4 w-4" aria-hidden />
					)}
				</button>
			</div>
		</div>
	);
}

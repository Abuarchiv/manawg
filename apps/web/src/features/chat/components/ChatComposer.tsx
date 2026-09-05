'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import { haptic } from '@/shared/lib/haptics';
import { Send, X } from 'lucide-react';
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
	draftKey: string;
	error: string | null;
	members: MentionMember[];
	currentMemberId: string;
	replyToMessageId: string | null;
	replyToPreview: string | null;
	replyToSenderName: string | null;
	onClearReply: () => void;
	onRestoreReply: (id: string | null) => void;
	onSend: (input: {
		body: string;
		mentionMemberIds: string[];
		replyToMessageId: string | null;
	}) => Promise<boolean>;
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
	draftKey,
	error,
	members,
	currentMemberId,
	replyToMessageId,
	replyToPreview,
	replyToSenderName,
	onClearReply,
	onRestoreReply,
	onSend,
}: ChatComposerProps) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [draft, setDraft] = useState('');
	const [pending, setPending] = useState(false);
	const pendingRef = useRef(false);
	const [draftHydrated, setDraftHydrated] = useState(false);
	const [draftStorageFailed, setDraftStorageFailed] = useState(false);
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
	useEffect(() => {
		const saved = readDraft<{ body?: string; replyToMessageId?: string }>(draftKey);
		if (typeof saved?.body === 'string') setDraft(saved.body.slice(0, BODY_MAX));
		onRestoreReply(typeof saved?.replyToMessageId === 'string' ? saved.replyToMessageId : null);
		setDraftHydrated(true);
	}, [draftKey, onRestoreReply]);

	useEffect(() => {
		if (!draftHydrated) return;
		if (!draft && !replyToMessageId) {
			removeDraft(draftKey);
			setDraftStorageFailed(false);
			return;
		}
		setDraftStorageFailed(!writeDraft(draftKey, { body: draft, replyToMessageId }));
	}, [draft, draftHydrated, draftKey, replyToMessageId]);

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
		if (pendingRef.current || !mention || !textareaRef.current) return;
		const value = textareaRef.current.value;
		const before = value.slice(0, mention.startIndex);
		const after = value.slice(mention.startIndex + 1 + mention.query.length);
		const insertion = `@${member.name} `;
		const next = `${before}${insertion}${after}`;
		if (next.length > BODY_MAX) return;
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
		if (text.length === 0 || text.length > BODY_MAX || pendingRef.current) return;
		pendingRef.current = true;
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
			pendingRef.current = false;
			setPending(false);
		}
	}

	function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
		if (e.nativeEvent.isComposing) return;
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
		<div className="relative shrink-0 border-t border-border bg-background" aria-busy={pending}>
			{replyToMessageId && (
				<div className="flex items-start gap-2 border-b border-border bg-muted px-3 py-2 text-xs">
					<div className="min-w-0 flex-1">
						<div className="font-medium text-foreground">
							Antwort an {replyToSenderName ?? 'Unbekannt'}
						</div>
						<div className="truncate text-muted-foreground">{replyToPreview ?? '…'}</div>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={onClearReply}
						disabled={pending}
						aria-label="Antwort abbrechen"
						className="min-h-11 min-w-11"
					>
						<X aria-hidden />
					</Button>
				</div>
			)}
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error} Dein Text ist noch da.</AlertDescription>
				</Alert>
			)}
			{draftStorageFailed && (
				<Alert>
					<AlertDescription>
						Der Entwurf kann auf diesem Gerät nicht gespeichert werden. Lass den Chat bis zum Senden
						geöffnet.
					</AlertDescription>
				</Alert>
			)}
			<MentionAutocomplete
				listboxId={mentionListboxId}
				items={mentionItems}
				activeIndex={mentionActiveIndex}
				onSelect={insertMention}
				onHoverIndex={setMentionActiveIndex}
			/>
			<div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-3 py-2">
				<InputGroup className="h-auto min-h-11 items-end">
					<InputGroupTextarea
						ref={textareaRef}
						value={draft}
						disabled={pending || !draftHydrated}
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
						className="max-h-32 min-h-11 flex-1 text-base md:text-base"
					/>
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							type="button"
							variant="default"
							size="icon-sm"
							onClick={() => void submit()}
							disabled={pending || !draftHydrated || draft.trim().length === 0}
							aria-label="Nachricht senden"
							className="min-h-11 min-w-11 shrink-0"
						>
							{pending ? <Spinner aria-hidden /> : <Send aria-hidden />}
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</div>
			{pending && (
				<output className="px-3 pb-2 text-xs text-muted-foreground">
					Nachricht wird gesendet…
				</output>
			)}
		</div>
	);
}

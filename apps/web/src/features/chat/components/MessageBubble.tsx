'use client';

import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import { useDismissableMenu } from '@/core/hooks/useDismissableMenu';
import { formatRelativeTime, formatTimeFull } from '@/core/utils/time';
import { haptic } from '@/shared/lib/haptics';
import { Loader2, MoreVertical, Pencil, Reply, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { canDeleteMessage, canEditMessage } from '../chat-pure';
import { ReactionPicker } from './ReactionPicker';

export interface BubbleMessage {
	id: string;
	senderMemberId: string | null;
	kind: string;
	body: string | null;
	imageUrl: string | null;
	createdAt: string;
	editedAt: string | null;
	deletedAt: string | null;
	replyToMessageId: string | null;
}

export interface ReactionSummary {
	emoji: string;
	count: number;
	mine: boolean;
}

interface MessageBubbleProps {
	message: BubbleMessage;
	sender: { name: string; color: string | null } | null;
	currentMemberId: string;
	isAdmin: boolean;
	isOwn: boolean;
	reactions: ReactionSummary[];
	replyTo: BubbleMessage | null;
	replyToSender: { name: string } | null;
	onReact: (emoji: string) => void;
	onUnreact: (emoji: string) => void;
	onEdit: (next: string) => Promise<void>;
	onDelete: () => Promise<void>;
	onReply: () => void;
}

export function MessageBubble({
	message,
	sender,
	currentMemberId,
	isAdmin,
	isOwn,
	reactions,
	replyTo,
	replyToSender,
	onReact,
	onUnreact,
	onEdit,
	onDelete,
	onReply,
}: MessageBubbleProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	// Bug 8: track whether menu should open upward
	const [menuAbove, setMenuAbove] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.body ?? '');
	const [pending, setPending] = useState(false);
	const { confirmId, request: requestDelete, cancel: cancelDelete } = useConfirmDelete();

	useEffect(() => {
		if (!menuOpen || !menuTriggerRef.current) return;
		// Bug 8: determine if trigger is in lower half of viewport
		const rect = menuTriggerRef.current.getBoundingClientRect();
		setMenuAbove(rect.top > window.innerHeight / 2);
	}, [menuOpen]);

	useDismissableMenu({
		open: menuOpen,
		onClose: () => {
			setMenuOpen(false);
			cancelDelete();
		},
		triggerRef: menuTriggerRef,
		menuRef,
	});

	const isDeleted = Boolean(message.deletedAt);
	const editable = canEditMessage(
		{
			id: message.id,
			senderMemberId: message.senderMemberId,
			kind: message.kind,
			deletedAt: message.deletedAt,
			createdAt: message.createdAt,
		},
		{ id: currentMemberId },
	);
	const deletable = canDeleteMessage(
		{
			id: message.id,
			senderMemberId: message.senderMemberId,
			kind: message.kind,
			deletedAt: message.deletedAt,
			createdAt: message.createdAt,
		},
		{ id: currentMemberId, role: isAdmin ? 'admin' : null },
	);

	const senderName = sender?.name ?? 'Unbekannt';
	const senderColor = sender?.color ?? null;
	const deleteArmed = confirmId === message.id;

	const actionBtnCls =
		'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[var(--text-3)] opacity-70 transition-colors transition-opacity hover:bg-[var(--surface)] hover:text-[var(--text-1)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1';

	async function saveEdit(): Promise<void> {
		const text = draft.trim();
		if (text.length === 0 || pending) return;
		setPending(true);
		try {
			await onEdit(text);
			setEditing(false);
		} finally {
			setPending(false);
		}
	}

	async function handleDelete(): Promise<void> {
		if (pending) return;
		setPending(true);
		try {
			await onDelete();
		} finally {
			setPending(false);
		}
	}

	return (
		<div
			id={`message-${message.id}`}
			className={`flex w-full gap-2 px-3 py-1 ${isOwn ? 'justify-end' : 'justify-start'}`}
		>
			{!isOwn && (
				<div className="pt-1">
					<MemberAvatar name={senderName} color={senderColor} size={28} />
				</div>
			)}
			{/* Breite relativ zum Container, nicht zum Viewport: der App-Frame ist auf
			    --app-frame-width gedeckelt, 100vw wäre auf Desktop ein Vielfaches davon
			    und die Blase liefe aus ihrer Zeile heraus. */}
			<div
				className={`min-w-0 max-w-[calc(100%-2.5rem)] sm:max-w-[78%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}
			>
				<div className="mb-0.5 flex items-baseline gap-2 text-[11px] text-[var(--text-3)]">
					{!isOwn && (
						// Bug 4: ensure font-weight 600 and no text-shadow
						<span
							className="font-semibold text-[var(--text-2)]"
							style={
								senderColor ? { color: senderColor, textShadow: 'none' } : { textShadow: 'none' }
							}
						>
							{senderName}
						</span>
					)}
					{/* Bug 7: cursor-help on time element */}
					<time
						dateTime={message.createdAt}
						title={formatTimeFull(message.createdAt)}
						className="cursor-help"
					>
						{formatRelativeTime(message.createdAt)}
					</time>
					{message.editedAt && <span>· bearbeitet</span>}
				</div>
				<div
					className={`relative min-w-0 max-w-full rounded-2xl px-3 py-2 text-[14px] shadow-sm ${
						isOwn
							? 'bg-[var(--accent)] text-[var(--accent-fg)]'
							: 'bg-[var(--surface)] text-[var(--text-1)]'
					} ${isDeleted ? 'italic opacity-70' : ''}`}
				>
					{replyTo && (
						// Bug 6: bg-black/15 for own, surface-strong for others
						<div
							className={`mb-1 min-w-0 overflow-hidden rounded-lg px-2 py-1 text-[12px] opacity-90 ${
								isOwn ? 'bg-white/20' : 'bg-[var(--surface-strong)]'
							}`}
						>
							<div className="truncate font-semibold">↪ {replyToSender?.name ?? 'Unbekannt'}</div>
							{/* anywhere statt break-words: nur `anywhere` senkt auch die
							    min-content-Breite, sonst bläht ein einzelnes überlanges Wort
							    die ganze Blase über ihre Zeile hinaus auf. */}
							<div className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
								{replyTo.body ?? (replyTo.imageUrl ? 'Bild' : '…')}
							</div>
						</div>
					)}
					{isDeleted ? (
						<span>Diese Nachricht wurde gelöscht.</span>
					) : editing ? (
						<div className="flex flex-col gap-2">
							{/* Bug 2: min-h-[80px] + resize-none */}
							<textarea
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
										e.preventDefault();
										void saveEdit();
									}
									if (e.key === 'Escape') {
										setEditing(false);
										setDraft(message.body ?? '');
									}
								}}
								rows={2}
								disabled={pending}
								maxLength={4000}
								aria-label="Nachricht bearbeiten"
								className="min-h-[80px] resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
							/>
							<div className="flex justify-end gap-1">
								<button
									type="button"
									onClick={() => {
										setEditing(false);
										setDraft(message.body ?? '');
									}}
									disabled={pending}
									className="min-h-11 rounded-md px-3 text-[12px] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
								>
									Abbrechen
								</button>
								<button
									type="button"
									onClick={() => void saveEdit()}
									disabled={pending || draft.trim().length === 0}
									className="inline-flex min-h-11 items-center gap-1 rounded-md bg-[var(--accent)]/20 px-3 text-[12px] font-medium transition-colors hover:bg-[var(--accent)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
								>
									{pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
									Speichern
								</button>
							</div>
						</div>
					) : (
						<>
							{message.body && (
								<p className="min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
									{message.body}
								</p>
							)}
							{message.imageUrl && (
								// Bug 5: wrap image in button for click-to-zoom
								<button
									type="button"
									aria-label="Bild in voller Größe öffnen"
									onClick={() => {
										if (message.imageUrl)
											window.open(message.imageUrl, '_blank', 'noopener,noreferrer');
									}}
									className="mt-1 block"
								>
									{/* eslint-disable-next-line @next/next/no-img-element */}
									<img
										src={message.imageUrl}
										alt={`Bild von ${senderName}`}
										loading="lazy"
										className="max-h-72 max-w-full rounded-lg"
									/>
								</button>
							)}
						</>
					)}
				</div>
				{(reactions.length > 0 || (!isDeleted && !editing)) && (
					// Bug 3: gap-0.5 to reduce spacing between reaction chips
					<div className="mt-1 flex flex-wrap items-center gap-0.5">
						{reactions.map((r) => (
							<button
								key={r.emoji}
								type="button"
								onClick={() => {
									haptic('selection');
									if (r.mine) {
										onUnreact(r.emoji);
									} else {
										onReact(r.emoji);
									}
								}}
								aria-pressed={r.mine}
								aria-label={`Reaktion ${r.emoji} (${r.count}) ${r.mine ? 'entfernen' : 'hinzufügen'} — Nachricht von ${senderName}`}
								className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border px-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
									r.mine
										? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
										: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] hover:border-[var(--border-strong)]'
								}`}
							>
								<span>{r.emoji}</span>
								<span className="tabular-nums">{r.count}</span>
							</button>
						))}
						{/* Bug 1: action buttons always rendered; opacity-60 on mobile, visible on sm: hover */}
						{!isDeleted && !editing && (
							<>
								<ReactionPicker
									onSelect={(emoji) => {
										haptic('selection');
										onReact(emoji);
									}}
									triggerLabel={`Reaktion zu Nachricht von ${senderName} (${formatRelativeTime(message.createdAt)}) hinzufügen`}
								/>
								{/* Bug 1 + Bug 9: Reply button */}
								<button
									type="button"
									onClick={() => {
										haptic('selection');
										onReply();
									}}
									aria-label={`Auf Nachricht von ${senderName} (${formatRelativeTime(message.createdAt)}) antworten`}
									className={actionBtnCls}
								>
									<Reply className="h-3.5 w-3.5" aria-hidden />
								</button>
								{(editable || deletable) && (
									// Bug 8: relative + transform-gpu for menu positioning
									<div className="relative transform-gpu">
										<button
											ref={menuTriggerRef}
											type="button"
											onClick={() => {
												cancelDelete();
												setMenuOpen((v) => !v);
											}}
											aria-label={`Aktionen für Nachricht von ${senderName} (${formatRelativeTime(message.createdAt)})`}
											aria-haspopup="dialog"
											aria-expanded={menuOpen}
											className={actionBtnCls}
										>
											<MoreVertical className="h-3.5 w-3.5" aria-hidden />
										</button>
										{menuOpen && (
											// Bug 8: position above or below based on viewport position
											<div
												ref={menuRef}
												// biome-ignore lint/a11y/useSemanticElements: <dialog> blocks scroll + has UA styling; intentional div+role pattern
												role="dialog"
												aria-label={`Aktionen für Nachricht von ${senderName} (${formatRelativeTime(message.createdAt)})`}
												className={`absolute right-0 z-10 min-w-[9rem] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)] py-1 text-[12px] shadow-lg ${
													menuAbove ? 'bottom-full mb-1' : 'top-full mt-1'
												}`}
											>
												{editable && (
													<button
														type="button"
														onClick={() => {
															setMenuOpen(false);
															setDraft(message.body ?? '');
															setEditing(true);
														}}
														className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
													>
														<Pencil className="h-3.5 w-3.5" aria-hidden />
														Bearbeiten
													</button>
												)}
												{deletable && (
													<button
														type="button"
														onClick={() => {
															if (!requestDelete(message.id)) return;
															setMenuOpen(false);
															void handleDelete();
														}}
														aria-label={deleteArmed ? 'Nachricht endgültig löschen' : 'Löschen'}
														className={`flex min-h-[44px] w-full items-center gap-2 px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--danger)] ${
															deleteArmed
																? 'bg-[var(--danger)] text-[var(--danger-fg)] hover:opacity-90'
																: 'text-[var(--danger)] hover:bg-[var(--danger)]/5'
														}`}
													>
														<Trash2 className="h-3.5 w-3.5" aria-hidden />
														{deleteArmed ? 'Jetzt löschen' : 'Löschen'}
													</button>
												)}
											</div>
										)}
									</div>
								)}
							</>
						)}
					</div>
				)}
			</div>
			{isOwn && (
				<div className="pt-1">
					<MemberAvatar name={senderName} color={senderColor} size={28} />
				</div>
			)}
		</div>
	);
}

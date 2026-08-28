'use client';

import { DeleteConfirmButton } from '@/components/ui/DeleteConfirmButton';
import { MemberAvatar } from '@/components/wg/dashboard/MemberAvatar';
import type { MemberInfo, ShoppingItem } from '@/components/wg/einkauf/shopping-types';
import { Check, Loader2, Receipt } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';

interface ShoppingItemRowProps {
	item: ShoppingItem;
	adder: MemberInfo;
	buyer: MemberInfo | null;
	isPending: (id: string) => boolean;
	onToggle: (item: ShoppingItem) => void;
	onRemove: (id: string) => void;
	highlighted: boolean;
	shareCode: string;
}

// Avatar size used for the meta row — matches other list pages (ausgaben uses 24)
const META_AVATAR_SIZE = 16;

export const ShoppingItemRow = memo(function ShoppingItemRow({
	item,
	adder,
	buyer,
	isPending,
	onToggle,
	onRemove,
	highlighted,
	shareCode,
}: ShoppingItemRowProps) {
	const isBought = item.boughtAt !== null;
	const pending = isPending(item.id);
	const displayMember = isBought ? buyer : adder;
	const wgBaseHref = `/wg/${encodeURIComponent(shareCode)}`;

	return (
		<li
			id={`shopping-${item.id}`}
			className={`group flex scroll-mt-24 items-center gap-3 px-3 py-2.5 sm:px-4 ${
				highlighted ? 'bg-[var(--accent)]/10 ring-2 ring-inset ring-[var(--accent)]' : ''
			}`}
		>
			<button
				type="button"
				aria-pressed={isBought}
				onClick={() => onToggle(item)}
				disabled={pending}
				aria-label={isBought ? `${item.name} wieder öffnen` : `${item.name} erledigen`}
				className={
					isBought
						? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--text-1)] text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:opacity-50'
						: 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-[var(--text-3)] transition-colors hover:border-[var(--text-1)] hover:text-[var(--text-1)] disabled:opacity-50'
				}
			>
				{pending ? (
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				) : (
					<Check className={isBought ? 'h-4 w-4' : 'h-4 w-4 opacity-30'} aria-hidden />
				)}
			</button>

			{/* Text content — consistent 2-line structure in both states */}
			<div className={`min-w-0 flex-1 ${isBought ? 'opacity-60' : ''}`}>
				{/* Name row — flex so quantity never truncates the name */}
				<div className="flex min-w-0 items-baseline gap-1.5">
					<span
						className={`truncate text-[14px] font-medium ${isBought ? 'text-[var(--text-2)] line-through' : 'text-[var(--text-1)]'}`}
					>
						{item.name}
					</span>
					{item.quantity && (
						<span className="shrink-0 text-[12.5px] text-[var(--text-3)]">{item.quantity}</span>
					)}
				</div>

				{/* Meta row — always rendered to prevent height shift between states */}
				<div className="mt-0.5 flex items-center gap-1 text-[12px] text-[var(--text-3)]">
					{displayMember ? (
						<>
							<MemberAvatar
								name={displayMember.name}
								color={displayMember.color}
								size={META_AVATAR_SIZE}
							/>
							<span>{`von ${displayMember.name}`}</span>
						</>
					) : (
						// Invisible placeholder preserves row height when buyer info is absent
						<span className="invisible text-[12px]" aria-hidden>
							&nbsp;
						</span>
					)}
				</div>
			</div>

			<DeleteConfirmButton
				id={item.id}
				onConfirm={() => onRemove(item.id)}
				pending={pending}
				ariaLabel={`${item.name} entfernen`}
				ariaLabelConfirm={`${item.name} entfernen bestätigen`}
			/>
			{isBought && (
				<Link
					href={`${wgBaseHref}/ausgaben?desc=${encodeURIComponent(item.name)}`}
					aria-label={`${item.name} als Ausgabe übernehmen`}
					className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<Receipt className="h-3.5 w-3.5" aria-hidden />
				</Link>
			)}
		</li>
	);
});

'use client';

import { Button } from '@/components/ui/button';
import type { TodayImportantItem } from '@/composition/dashboard-insights';
import { formatEuroCents } from '@/core/utils/money';
import { getChoreStatus } from '@/features/chores/chore-status';
import {
	ChoreCompleteDialog,
	completeTriggerLabel,
} from '@/features/chores/components/ChoreCompleteDialog';
import { cn } from '@/shared/lib/cn';
import { ChevronRight, Circle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { TodayIcon } from './TodayIcon';

export function TodayRow({
	item,
	pending,
	confirming,
	error,
	onCheck,
	onCancel,
	onConfirm,
}: {
	item: TodayImportantItem;
	pending: boolean;
	confirming: boolean;
	error: string | null;
	onCheck: () => void;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const checkable = item.kind === 'chore' && item.isPersonal && Boolean(item.entityId);
	const actionLabel = getChoreStatus(item.expectedNextDueAt ?? '').actionLabel;
	const debtAmount =
		item.kind === 'debt' && item.amountCents !== undefined
			? formatEuroCents(item.amountCents, item.currency, { signed: true })
			: undefined;
	return (
		<li className="flex min-w-0 items-center gap-2 pl-2 pr-2">
			{checkable ? (
				<Button
					variant="ghost"
					size="icon"
					className="shrink-0"
					aria-label={completeTriggerLabel(item.title, actionLabel)}
					// aria-disabled instead of disabled: otherwise the button loses focus while saving.
					aria-disabled={pending}
					onClick={() => {
						if (!pending) onCheck();
					}}
				>
					{pending ? (
						<Loader2 className="animate-spin" aria-hidden />
					) : (
						<Circle className="text-muted-foreground" aria-hidden />
					)}
				</Button>
			) : (
				<span className="flex size-8 shrink-0 items-center justify-center">
					<TodayIcon kind={item.kind} />
				</span>
			)}
			<Link
				href={item.href}
				className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 rounded-lg py-1.5 outline-none transition-colors duration-75 active:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<span className="flex min-w-16 flex-1 flex-col">
					<span className="line-clamp-3 text-[14px] font-medium leading-snug break-words">
						{item.title}
					</span>
					<span
						className={cn(
							'text-pretty text-[12px] text-muted-foreground',
							item.kind === 'recurring' && 'tabular-nums',
						)}
					>
						{pending ? 'Wird gespeichert…' : item.detail}
					</span>
				</span>
				<span className="ml-auto flex shrink-0 items-center gap-2">
					{debtAmount !== undefined && !pending && (
						<span className="whitespace-nowrap font-mono text-[12px] font-medium tabular-nums">
							{debtAmount}
						</span>
					)}
					<ChevronRight className="size-4 text-muted-foreground" aria-hidden />
				</span>
			</Link>
			{checkable && (
				<ChoreCompleteDialog
					open={confirming}
					title={item.title}
					actionLabel={actionLabel}
					busy={pending}
					error={error}
					onCancel={onCancel}
					onConfirm={onConfirm}
				/>
			)}
		</li>
	);
}

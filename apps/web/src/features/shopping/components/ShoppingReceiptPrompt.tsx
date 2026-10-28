import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { expensePrefillHref } from '@/features/shopping/shopping-view';
import { cn } from '@/shared/lib/cn';

const RECEIPT_PROMPT_WINDOW_MS = 12 * 60 * 60 * 1000;
// Only whoever just checked off themselves gets the notice brought into view, not on load.
const RECEIPT_SCROLL_WINDOW_MS = 10_000;

/** After shopping: capture the own freshly bought items directly as an expense. */
export function ShoppingReceiptPrompt({
	doneItems,
	memberId,
	shareCode,
}: {
	doneItems: ShoppingItem[];
	memberId: string;
	shareCode: string;
}) {
	const [receiptSince, setReceiptSince] = useState<string | null>(null);
	const receiptKey = `manawg:receipt-prompt:${shareCode}`;
	useEffect(() => {
		try {
			setReceiptSince(window.localStorage.getItem(receiptKey));
		} catch {
			// Without storage, the notice appears only for the last few hours.
		}
	}, [receiptKey]);
	const receiptCutoff = Math.max(
		Date.now() - RECEIPT_PROMPT_WINDOW_MS,
		receiptSince ? Date.parse(receiptSince) || 0 : 0,
	);
	const myFreshBought = doneItems.filter(
		(item) =>
			item.boughtByMemberId === memberId &&
			item.boughtAt !== null &&
			Date.parse(item.boughtAt) > receiptCutoff,
	);
	const promptRef = useRef<HTMLDivElement>(null);
	const previousCount = useRef(0);
	const freshCount = myFreshBought.length;
	const newestBoughtAt = Math.max(
		0,
		...myFreshBought.map((item) => Date.parse(item.boughtAt ?? '')),
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: react to the count only
	useEffect(() => {
		const rose = freshCount > previousCount.current;
		previousCount.current = freshCount;
		if (rose && Date.now() - newestBoughtAt < RECEIPT_SCROLL_WINDOW_MS) {
			// The page's scroll-padding-bottom (ThumbAction) keeps the card above the fixed bar.
			promptRef.current?.scrollIntoView({ block: 'nearest' });
		}
	}, [freshCount]);
	if (freshCount === 0) return null;

	function dismissReceiptPrompt(): void {
		const now = new Date().toISOString();
		setReceiptSince(now);
		try {
			window.localStorage.setItem(receiptKey, now);
		} catch {
			// The notice is then hidden for this session only.
		}
	}

	return (
		<Alert ref={promptRef}>
			<Receipt aria-hidden />
			<AlertDescription className="flex flex-col gap-2 text-xs">
				<span>Beleg für {myFreshBought.length} Artikel als Ausgabe erfassen?</span>
				<span className="flex flex-wrap gap-2">
					<Link
						href={expensePrefillHref(shareCode, {
							new: '1',
							desc: `Einkauf: ${myFreshBought
								.slice(0, 5)
								.map((item) => item.name)
								.join(', ')}`,
						})}
						onClick={dismissReceiptPrompt}
						className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'no-underline!')}
					>
						Ausgabe erfassen
					</Link>
					<Button variant="ghost" size="sm" onClick={dismissReceiptPrompt}>
						Nicht jetzt
					</Button>
				</span>
			</AlertDescription>
		</Alert>
	);
}

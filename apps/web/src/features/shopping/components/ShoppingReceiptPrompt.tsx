import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { cn } from '@/shared/lib/cn';
import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const RECEIPT_PROMPT_WINDOW_MS = 12 * 60 * 60 * 1000;
// Nur wer gerade selbst abgehakt hat, bekommt den Hinweis in den Blick geholt, nicht beim Laden.
const RECEIPT_SCROLL_WINDOW_MS = 10_000;

/** Nach dem Einkauf: eigene frisch gekaufte Artikel direkt als Ausgabe erfassen. */
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
			// Ohne Speicher erscheint der Hinweis nur für die letzten Stunden.
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: nur auf die Anzahl reagieren
	useEffect(() => {
		const rose = freshCount > previousCount.current;
		previousCount.current = freshCount;
		if (rose && Date.now() - newestBoughtAt < RECEIPT_SCROLL_WINDOW_MS) {
			// scroll-padding-bottom der Seite (ThumbAction) hält die Karte über der festen Leiste.
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
			// Hinweis bleibt dann nur in dieser Sitzung ausgeblendet.
		}
	}

	return (
		<Alert ref={promptRef}>
			<Receipt aria-hidden />
			<AlertDescription className="flex flex-col gap-2 text-[13px]">
				<span>Beleg für {myFreshBought.length} Artikel als Ausgabe erfassen?</span>
				<span className="flex flex-wrap gap-2">
					<Link
						href={`/wg/${encodeURIComponent(shareCode)}/ausgaben?new=1&desc=${encodeURIComponent(
							`Einkauf: ${myFreshBought
								.slice(0, 5)
								.map((item) => item.name)
								.join(', ')}`,
						)}`}
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

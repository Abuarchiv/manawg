import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { cn } from '@/shared/lib/cn';
import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const RECEIPT_PROMPT_WINDOW_MS = 12 * 60 * 60 * 1000;

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
	if (myFreshBought.length === 0) return null;

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
		<Alert>
			<Receipt aria-hidden />
			<AlertDescription className="flex flex-col gap-2 text-[12px]">
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

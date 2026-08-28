'use client';

import { Package } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface InventoryItem {
	id: string;
	name: string;
	quantity: number;
	threshold: number;
	unit: string;
}

interface InventoryResponse {
	items: InventoryItem[];
}

interface Props {
	shareCode: string;
	memberId: string;
}

type LoadState = 'loading' | 'ready' | 'unavailable';

const MAX_DISPLAY_ITEMS = 3;

export function VorraeteCard({ shareCode, memberId }: Props) {
	const encoded = encodeURIComponent(shareCode);
	const href = `/wg/${encoded}/vorraete`;
	const [state, setState] = useState<LoadState>('loading');
	const [items, setItems] = useState<InventoryItem[]>([]);

	useEffect(() => {
		const controller = new AbortController();
		const url = `/api/wg/${encoded}/inventory?lowStock=true`;

		fetch(url, {
			signal: controller.signal,
			cache: 'no-store',
			headers: { 'x-manawg-member-id': memberId },
		})
			.then(async (res) => {
				if (res.status === 404) {
					setState('unavailable');
					return;
				}
				if (!res.ok) {
					setState('ready');
					setItems([]);
					return;
				}
				try {
					const body = (await res.json()) as InventoryResponse;
					setItems(Array.isArray(body.items) ? body.items : []);
					setState('ready');
				} catch {
					setState('ready');
					setItems([]);
				}
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				setState('ready');
				setItems([]);
			});

		return () => controller.abort();
	}, [encoded, memberId]);

	return (
		<Link
			href={href}
			className="flex h-full flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color,background-color] duration-150 hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
		>
			<header className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Package
						className="h-4 w-4 shrink-0 text-[var(--text-3)]"
						strokeWidth={1.75}
						aria-hidden
					/>
					<h2 className="text-[13px] font-medium text-[var(--text-2)]">Vorräte</h2>
				</div>
				{state === 'ready' && items.length > 0 && (
					<span className="rounded-full border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-1.5 py-0.5 text-[11px] font-medium text-[var(--danger)]">
						niedrig
					</span>
				)}
			</header>
			<div className="mt-3 flex-1 text-[13px] text-[var(--text-1)]">
				{state === 'loading' && <p className="text-[12.5px] text-[var(--text-3)]">Lädt Vorräte…</p>}
				{state === 'unavailable' && (
					<p className="text-[12.5px] text-[var(--text-3)]">Feature kommt bald</p>
				)}
				{state === 'ready' && items.length === 0 && (
					<p className="text-[12.5px] text-[var(--text-3)]">Alle Vorräte ausreichend</p>
				)}
				{state === 'ready' && items.length > 0 && (
					<ul className="space-y-1.5">
						{items.slice(0, MAX_DISPLAY_ITEMS).map((item) => (
							<li key={item.id} className="flex justify-between gap-2">
								<span className="truncate" title={item.name}>
									{item.name}
								</span>
								<span className="shrink-0 text-[12px] tabular-nums text-[var(--text-3)]">
									{item.quantity} {item.unit} / {item.threshold}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</Link>
	);
}

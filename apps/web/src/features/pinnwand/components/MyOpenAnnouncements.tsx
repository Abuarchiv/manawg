'use client';
import type { Announcement } from '@/features/pinnwand/components/announcement-types';
import { KIND_LABELS } from '@/features/pinnwand/components/constants';
import type React from 'react';

interface MyOpenAnnouncementsProps {
	items: Announcement[];
	onSelect: (id: string) => void;
}

export function MyOpenAnnouncements({
	items,
	onSelect,
}: MyOpenAnnouncementsProps): React.ReactElement {
	return (
		<section className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/[0.04] px-4 py-3">
			<div className="mb-2 flex items-center justify-between gap-2">
				<h2 className="text-[13px] font-semibold text-[var(--text-1)]">Meine offenen Sachen</h2>
				<span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
					{items.length}
				</span>
			</div>
			<div className="flex gap-2 overflow-x-auto pb-1">
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={() => onSelect(item.id)}
						className="min-h-11 min-w-[140px] max-w-[200px] rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-left text-[12px] text-[var(--text-2)] sm:min-w-[180px] sm:max-w-[240px]"
					>
						<span className="mb-1 block font-semibold text-[var(--text-1)]">
							{KIND_LABELS[item.kind]}
						</span>
						<span className="line-clamp-2">{item.content}</span>
					</button>
				))}
			</div>
		</section>
	);
}

'use client';

import { ChevronRight, Hand } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Announcement } from './announcement-types';

export function MyOpenAnnouncements({
	items,
	onSelect,
}: {
	items: Announcement[];
	onSelect: (id: string) => void;
}) {
	const t = useTranslations('pinnwand');
	return (
		<section className="flex flex-col gap-2" aria-labelledby="my-announcements">
			<div className="flex items-center gap-2">
				<Hand className="size-4" aria-hidden />
				<h2 id="my-announcements" className="text-sm font-medium">
					{t('mine.title')}
				</h2>
				<Badge variant="secondary">{items.length}</Badge>
			</div>
			<div className="flex gap-2 overflow-x-auto pb-1">
				{items.map((item) => (
					<Button
						key={item.id}
						variant="outline"
						onClick={() => onSelect(item.id)}
						className="h-auto min-h-16 w-56 max-w-full shrink-0 justify-between whitespace-normal py-3 text-left"
					>
						<span className="flex min-w-0 flex-col gap-1">
							<span>{t(`kind.${item.kind}`)}</span>
							<span className="line-clamp-2 font-normal [overflow-wrap:anywhere]">
								{item.content}
							</span>
						</span>
						<ChevronRight data-icon="inline-end" aria-hidden />
					</Button>
				))}
			</div>
		</section>
	);
}

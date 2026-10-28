'use client';

import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemGroup, ItemGroupEntry, ItemTitle } from '@/components/ui/item';
import { Section } from '@/components/wg/settings/Section';
import { type AccountWg, fetchAccountWgs } from '@/core/infra/account-wgs';

/** The account's other WGs, so switching never needs the browser's back button. */
export function AccountWgsSection({ currentCode }: { currentCode: string }) {
	const t = useTranslations('settings.accountWgs');
	const [others, setOthers] = useState<AccountWg[]>([]);

	useEffect(() => {
		let active = true;
		void fetchAccountWgs().then((res) => {
			if (!active || !res.ok) return;
			setOthers(res.wgs.filter((wg) => wg.code !== currentCode));
		});
		return () => {
			active = false;
		};
	}, [currentCode]);

	return (
		<Section title={t('title')}>
			<div className="flex flex-col gap-2 p-3">
				{others.length > 0 && (
					<ItemGroup>
						{others.map((wg) => (
							<ItemGroupEntry key={wg.id} className="w-full min-w-0">
								<Item
									variant="outline"
									render={<Link href={`/wg/${encodeURIComponent(wg.code)}`} />}
								>
									<ItemContent className="min-w-0">
										<ItemTitle className="line-clamp-none break-words">{wg.name}</ItemTitle>
									</ItemContent>
									<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								</Item>
							</ItemGroupEntry>
						))}
					</ItemGroup>
				)}
				<Button variant="outline" nativeButton={false} render={<Link href="/login" />}>
					<Plus aria-hidden />
					{t('addAnother')}
				</Button>
			</div>
		</Section>
	);
}

'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemGroupEntry,
	ItemTitle,
} from '@/components/ui/item';
import type { AccountWg } from '@/core/infra/account-wgs';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export type { AccountWg };

export function MembershipCard({ memberships }: { memberships: AccountWg[] }) {
	const t = useTranslations('entry.membership');
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t('title')}</h2>
				</CardTitle>
				<CardDescription>{t('question')}</CardDescription>
			</CardHeader>
			<CardContent>
				<ItemGroup>
					{memberships.map((membership) => (
						<ItemGroupEntry key={membership.id} className="w-full min-w-0">
							<Item
								variant="outline"
								render={<Link href={`/wg/${encodeURIComponent(membership.code)}`} />}
							>
								<ItemContent className="min-w-0">
									<ItemTitle className="line-clamp-none break-words">{membership.name}</ItemTitle>
									<ItemDescription>{t('open')}</ItemDescription>
								</ItemContent>
								<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
							</Item>
						</ItemGroupEntry>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

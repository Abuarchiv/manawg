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
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

export interface AccountWg {
	id: string;
	code: string;
	name: string;
}

export function MembershipCard({ memberships }: { memberships: AccountWg[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>Deine WGs</h2>
				</CardTitle>
				<CardDescription>Wo möchtest du weitermachen?</CardDescription>
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
									<ItemDescription>WG öffnen</ItemDescription>
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

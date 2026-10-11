'use client';

import { Button } from '@/components/ui/button';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemGroupEntry,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { Home, KeyRound, Plus } from 'lucide-react';
import Link from 'next/link';
import type { AccountWg } from './start-flow';

interface ChooseStepProps {
	accountWgs: AccountWg[];
	interactive: boolean;
	busy: boolean;
	onCreate: () => void;
	onJoin: () => void;
}

export function ChooseStep({ accountWgs, interactive, busy, onCreate, onJoin }: ChooseStepProps) {
	return (
		<div className="flex flex-col gap-4">
			{accountWgs.length > 0 && (
				<section aria-labelledby="your-wgs-heading" className="flex flex-col gap-3">
					<h2 id="your-wgs-heading" className="sr-only">
						Deine WGs
					</h2>
					<ItemGroup>
						{accountWgs.map((accountWg) => (
							<ItemGroupEntry key={accountWg.id} className="w-full min-w-0">
								<Item
									variant="outline"
									render={<Link href={`/wg/${encodeURIComponent(accountWg.code)}`} />}
								>
									<ItemMedia variant="icon">
										<Home aria-hidden />
									</ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle className="line-clamp-none break-words">{accountWg.name}</ItemTitle>
										<ItemDescription>WG öffnen</ItemDescription>
									</ItemContent>
								</Item>
							</ItemGroupEntry>
						))}
					</ItemGroup>
				</section>
			)}
			<div className="flex flex-col gap-2">
				<Button size="lg" disabled={!interactive || busy} onClick={onCreate} className="w-full">
					<Plus data-icon="inline-start" aria-hidden /> Neue WG erstellen
				</Button>
				<Button
					size="lg"
					variant="outline"
					disabled={!interactive || busy}
					onClick={onJoin}
					className="w-full"
				>
					<KeyRound data-icon="inline-start" aria-hidden /> Per Code beitreten
				</Button>
			</div>
		</div>
	);
}

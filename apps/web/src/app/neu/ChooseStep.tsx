'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { LegacyAccountRecovery } from '@/components/auth/LegacyAccountRecovery';
import { Button } from '@/components/ui/button';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { ChevronDown, Home, KeyRound, Plus } from 'lucide-react';
import Link from 'next/link';
import type { AccountWg } from './start-flow';

interface ChooseStepProps {
	accountWgs: AccountWg[];
	interactive: boolean;
	busy: boolean;
	legacyOpen: boolean;
	onLegacyOpenChange: (open: boolean) => void;
	onCreate: () => void;
	onJoin: () => void;
}

export function ChooseStep({
	accountWgs,
	interactive,
	busy,
	legacyOpen,
	onLegacyOpenChange,
	onCreate,
	onJoin,
}: ChooseStepProps) {
	return (
		<div className="flex flex-col gap-4">
			{accountWgs.length > 0 && (
				<section aria-labelledby="your-wgs-heading" className="flex flex-col gap-3">
					<h2 id="your-wgs-heading" className="text-base font-semibold">
						Deine WGs
					</h2>
					<ItemGroup>
						{accountWgs.map((accountWg) => (
							<Item
								key={accountWg.id}
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
			<Collapsible open={legacyOpen} onOpenChange={onLegacyOpenChange}>
				<CollapsibleTrigger
					render={
						<Button
							variant="ghost"
							className="h-auto w-full justify-between whitespace-normal text-left"
						/>
					}
				>
					Altes Profil auf diesem Gerät wiederherstellen
					<ChevronDown data-icon="inline-end" aria-hidden />
				</CollapsibleTrigger>
				<CollapsiblePanel keepRendered>
					<div inert={!legacyOpen} className="pt-3">
						<LegacyAccountRecovery />
					</div>
				</CollapsiblePanel>
			</Collapsible>
		</div>
	);
}

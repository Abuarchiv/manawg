'use client';

import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import type { KnownWg } from '@/shared/lib/identity';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { type OfflineStatus, formatWgQueuedActionCount, wgHref } from './offline-page-helpers';

interface KnownWgsCardProps {
	status: OfflineStatus;
	knownWgs: KnownWg[];
	hasIdentity: boolean;
	queueCounts: Map<string, number>;
	primaryWg: KnownWg | null;
}

/** Ways back into a WG: remembered WGs, the queue review and the code entry. */
export function KnownWgsCard({
	status,
	knownWgs,
	hasIdentity,
	queueCounts,
	primaryWg,
}: KnownWgsCardProps) {
	return (
		<section
			aria-labelledby="known-wgs-heading"
			className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
		>
			<div>
				<h2 id="known-wgs-heading" className="font-heading text-base leading-5 font-semibold">
					Zurück in deine WG
				</h2>
			</div>
			<div className="space-y-2">
				{knownWgs.length === 0 ? (
					<p className="text-sm leading-relaxed text-muted-foreground">
						{status === 'checking'
							? 'Gemerkte WGs werden gesucht…'
							: hasIdentity
								? 'Auf diesem Gerät bist du in einer WG angemeldet, aber ihr Code ist hier nicht gespeichert. Sobald du wieder online bist, öffnet sich deine WG wieder.'
								: status === 'browser-offline'
									? 'Ohne Netz zeigen wir nur WGs mit wartenden Aktionen. Sobald du wieder online bist, öffnet sich deine WG wieder.'
									: 'Noch keine WG auf diesem Gerät gemerkt. Sobald du wieder online bist, kannst du mit deinem Code erneut beitreten.'}
					</p>
				) : (
					<ItemGroup aria-label="Bekannte WGs">
						{knownWgs.slice(0, 3).map((wg) => (
							// biome-ignore lint/a11y/useSemanticElements: ItemGroup is a div[role=list], a bare <li> would be invalid HTML
							<div key={wg.code} role="listitem" className="w-full min-w-0">
								<Item
									variant="outline"
									render={<Link href={wgHref(wg.code)} aria-label={`${wg.name} öffnen`} />}
								>
									<ItemContent className="basis-40">
										<ItemTitle className="line-clamp-none [overflow-wrap:break-word]">
											{wg.name}
										</ItemTitle>
										<ItemDescription>
											{formatWgQueuedActionCount(queueCounts.get(wg.code) ?? 0)}
										</ItemDescription>
									</ItemContent>
									<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
								</Item>
							</div>
						))}
					</ItemGroup>
				)}

				<div className="grid grid-cols-1 gap-2 pt-2">
					{primaryWg && (
						<Button
							variant="outline"
							size="lg"
							render={<Link href={wgHref(primaryWg.code, '/einstellungen#daten')} />}
							nativeButton={false}
							className="w-full"
						>
							Aktionen prüfen
						</Button>
					)}
					<Button
						variant="outline"
						size="lg"
						render={<Link href="/neu" />}
						nativeButton={false}
						className="w-full"
					>
						Code eingeben
					</Button>
				</div>
			</div>
		</section>
	);
}

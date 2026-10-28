'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemGroupEntry,
	ItemTitle,
} from '@/components/ui/item';
import type { KnownWg } from '@/core/auth/local-account';
import { useMessage } from '@/shared/i18n/message';
import { type OfflineStatus, wgHref, wgQueuedActionCountMessage } from './offline-page-helpers';

interface KnownWgsCardProps {
	status: OfflineStatus;
	knownWgs: KnownWg[];
	inWg: boolean;
	queueCounts: Map<string, number>;
	primaryWg: KnownWg | null;
}

/** Ways back into a WG: remembered WGs, the queue review and the code entry. */
export function KnownWgsCard({
	status,
	knownWgs,
	inWg,
	queueCounts,
	primaryWg,
}: KnownWgsCardProps) {
	const t = useTranslations('offline.page.flats');
	const message = useMessage();
	// WG pages are never cached, so offline a link would only reload the offline page.
	const offline = status === 'browser-offline';
	return (
		<section
			aria-labelledby="known-wgs-heading"
			className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
		>
			<div>
				<h2 id="known-wgs-heading" className="font-heading text-base leading-5 font-semibold">
					{knownWgs.length === 0 ? t('titleNone') : t('titleSome')}
				</h2>
			</div>
			<div className="space-y-2">
				{offline && knownWgs.length > 0 && (
					<p className="text-xs text-muted-foreground">
						{t('openLater', { count: knownWgs.length })}
					</p>
				)}
				{knownWgs.length === 0 ? (
					<p className="text-sm leading-relaxed text-muted-foreground">
						{status === 'checking'
							? t('looking')
							: inWg
								? status === 'ready'
									? t('codeMissing')
									: t('codeMissingOffline')
								: status === 'ready'
									? t('noneRemembered')
									: t('noneRememberedOffline')}
					</p>
				) : (
					<ItemGroup aria-label={t('listLabel')}>
						{knownWgs.slice(0, 3).map((wg) => (
							<ItemGroupEntry key={wg.code} className="w-full min-w-0">
								<Item
									variant="outline"
									render={
										offline ? undefined : (
											<Link href={wgHref(wg.code)} aria-label={t('open', { name: wg.name })} />
										)
									}
								>
									<ItemContent className="basis-40">
										<ItemTitle className="line-clamp-none [overflow-wrap:break-word]">
											{wg.name}
										</ItemTitle>
										<ItemDescription>
											{message(wgQueuedActionCountMessage(queueCounts.get(wg.code) ?? 0))}
										</ItemDescription>
									</ItemContent>
									{!offline && (
										<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
									)}
								</Item>
							</ItemGroupEntry>
						))}
					</ItemGroup>
				)}

				<div className="grid grid-cols-1 gap-2 pt-2">
					{primaryWg && (queueCounts.get(primaryWg.code) ?? 0) > 0 && (
						<Button
							variant="outline"
							size="lg"
							render={<Link href={wgHref(primaryWg.code, '/einstellungen#daten')} />}
							nativeButton={false}
							className="w-full"
						>
							{t('checkActions')}
						</Button>
					)}
					<Button
						variant="outline"
						size="lg"
						render={<Link href="/neu" />}
						nativeButton={false}
						className="w-full"
					>
						{t('enterCode')}
					</Button>
				</div>
			</div>
		</section>
	);
}

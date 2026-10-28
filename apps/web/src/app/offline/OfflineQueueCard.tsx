'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { richArgument } from '@/components/entry/rich-argument';
import {
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import type { KnownWg } from '@/core/auth/local-account';
import { titled } from '@/core/offline/offline-failure-copy';
import {
	getOfflineActionRisk,
	getOfflineActionSummary,
	type OfflineAction,
} from '@/core/offline/offline-queue';
import { useMessage } from '@/shared/i18n/message';
import {
	type OfflineStatus,
	offlineAgeMessage,
	queuedActionCountMessage,
	wgHref,
} from './offline-page-helpers';

const RECENT_VISIBLE = 4;

/** The newest queued actions; the full list lives in the WG settings. */
export function OfflineQueueCard({
	queue,
	primaryWg,
	status,
}: {
	queue: OfflineAction[];
	primaryWg: KnownWg | null;
	status: OfflineStatus;
}) {
	const t = useTranslations('offline.page');
	const message = useMessage();
	const common = useTranslations('common');
	const recentQueue = queue.slice(-RECENT_VISIBLE).reverse();
	const hiddenQueueCount = Math.max(0, queue.length - recentQueue.length);
	return (
		<section
			aria-labelledby="offline-queue-heading"
			className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 id="offline-queue-heading" className="font-heading text-base leading-5 font-semibold">
						{t('heading')}
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{status === 'checking'
							? common('loading')
							: status === 'unauthenticated'
								? t('unauthenticated')
								: message(queuedActionCountMessage(queue.length))}
					</p>
				</div>
			</div>
			{recentQueue.length > 0 && (
				<ItemGroup className="gap-2" aria-label={t('queueLabel')}>
					{recentQueue.map((item) => {
						const summary = getOfflineActionSummary(item);
						const risk = getOfflineActionRisk(item);
						const lastError = item.lastErrorMessage
							? message(item.lastErrorMessage)
							: item.lastError;
						return (
							<ItemEntry key={item.id} variant="outline" className="items-start">
								<ItemContent className="basis-40">
									<ItemTitle className="line-clamp-none [overflow-wrap:break-word]">
										{message(summary.title)}
									</ItemTitle>
									<ItemDescription className="line-clamp-1">
										{message(summary.detail)}
									</ItemDescription>
									{(lastError || risk) && (
										<p className="mt-1 text-xs text-muted-foreground">
											{lastError && <span className="text-destructive">{lastError}</span>}
											{lastError && risk ? ' ' : null}
											{risk && message(titled(risk))}
										</p>
									)}
								</ItemContent>
								<span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
									{message(offlineAgeMessage(item.createdAt))}
								</span>
							</ItemEntry>
						);
					})}
				</ItemGroup>
			)}
			{hiddenQueueCount > 0 && (
				<>
					<Separator />
					<p className="text-sm text-muted-foreground">
						{t.rich('hidden', {
							count: hiddenQueueCount,
							link: richArgument(
								primaryWg ? (
									<Link
										href={wgHref(primaryWg.code, '/settings#data')}
										className="text-primary underline underline-offset-4"
									>
										{t('hiddenLink')}
									</Link>
								) : (
									t('hiddenLink')
								),
							),
						})}
					</p>
				</>
			)}
		</section>
	);
}

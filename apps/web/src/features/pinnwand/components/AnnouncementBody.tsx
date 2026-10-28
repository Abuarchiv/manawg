'use client';

import { Button } from '@/components/ui/button';
import { relativeTimeMessage } from '@/core/utils/time';
import { isLongAnnouncementBody } from '@/features/pinnwand/announcement-card-model';
import type { Locale } from '@/shared/i18n/locale';
import { useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';
import { CheckCircle2, ChevronDown, ChevronUp, Hand, ImageOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Announcement } from './announcement-types';

interface AnnouncementBodyProps {
	announcement: Announcement;
	bodyText: string;
	actionSubject: string;
	busy: boolean;
}

/** Text (collapsible when long), image attachment and the takers / resolved / saving line. */
export function AnnouncementBody({
	announcement,
	bodyText,
	actionSubject,
	busy,
}: AnnouncementBodyProps) {
	const t = useTranslations('pinnwand.card');
	const render = useMessage();
	const locale = useLocale() as Locale;
	const [imageFailed, setImageFailed] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const isLong = isLongAnnouncementBody(bodyText);
	const takerNames = announcement.takers.map((taker) => taker.name);
	return (
		<>
			{bodyText && (
				<div className="flex flex-col items-start gap-1">
					<p
						id={`announcement-body-${announcement.id}`}
						className={cn(
							'text-body whitespace-pre-wrap leading-normal [overflow-wrap:anywhere]',
							isLong && !expanded && 'line-clamp-4',
						)}
					>
						{bodyText}
					</p>
					{isLong && (
						<Button
							variant="ghost"
							className="-ml-2.5"
							onClick={() => setExpanded((value) => !value)}
							aria-expanded={expanded}
							aria-controls={`announcement-body-${announcement.id}`}
							aria-label={t(expanded ? 'showLessAria' : 'showMoreAria', { subject: actionSubject })}
						>
							{expanded ? (
								<ChevronUp data-icon="inline-start" />
							) : (
								<ChevronDown data-icon="inline-start" />
							)}
							{t(expanded ? 'showLess' : 'showMore')}
						</Button>
					)}
				</div>
			)}
			{announcement.imageUrl && (
				<a
					href={announcement.imageUrl}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={t('imageAria', { subject: actionSubject })}
					className="block"
				>
					{imageFailed ? (
						<span className="flex h-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
							<ImageOff aria-hidden />
						</span>
					) : (
						<img
							src={announcement.imageUrl}
							alt=""
							loading="lazy"
							onError={() => setImageFailed(true)}
							className="max-h-40 w-full rounded-lg object-cover"
						/>
					)}
				</a>
			)}
			{(takerNames.length > 0 || announcement.resolvedAt) && (
				<p className="flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground [overflow-wrap:anywhere]">
					{takerNames.length > 0 && (
						<span className="inline-flex items-center gap-1 text-foreground">
							<Hand className="size-3.5 shrink-0" aria-hidden />
							{t('takers', { count: takerNames.length, names: takerNames.join(', ') })}
						</span>
					)}
					{announcement.resolvedAt && (
						<span className="inline-flex items-center gap-1">
							<CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
							{t('resolvedAt', {
								time: render(relativeTimeMessage(announcement.resolvedAt, Date.now(), locale)),
							})}
						</span>
					)}
				</p>
			)}
			{/* Screen readers only: a visible line would shift the action bar while typing. */}
			{busy && <output className="sr-only">{t('saving')}</output>}
		</>
	);
}

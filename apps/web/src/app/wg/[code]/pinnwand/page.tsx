'use client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { SubNav } from '@/components/wg/SubNav';
import { ThumbAction } from '@/components/wg/ThumbAction';
import {
	ANNOUNCEMENT_REACTIONS,
	getAnnouncementHash,
} from '@/features/pinnwand/announcement-workflow';
import { AnnouncementCard } from '@/features/pinnwand/components/AnnouncementCard';
import { AnnouncementSkeleton } from '@/features/pinnwand/components/AnnouncementSkeleton';
import { EmptyState } from '@/features/pinnwand/components/EmptyState';
import { MyOpenAnnouncements } from '@/features/pinnwand/components/MyOpenAnnouncements';
import { PinnwandComposer } from '@/features/pinnwand/components/PinnwandComposer';
import type { Announcement } from '@/features/pinnwand/components/announcement-types';
import { usePinnwandPage } from '@/features/pinnwand/hooks/use-pinnwand-page';
import { useMessage } from '@/shared/i18n/message';
import { Megaphone, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type React from 'react';

export default function PinnwandPage(): React.ReactElement {
	const t = useTranslations('pinnwand.page');
	const tCommon = useTranslations('common');
	const render = useMessage();
	const {
		wg,
		identity,
		isAdmin,
		items,
		openItems,
		myOpenItems,
		visibleOpenCount,
		showMoreOpen,
		showSkeleton,
		loadError,
		refreshing,
		load,
		newCount,
		applyPendingItems,
		queuedCount,
		notice,
		setNotice,
		highlightedId,
		scrollToAnnouncement,
		authorByMemberId,
		isPending,
		stableDelete,
		stableTogglePinned,
		stableToggleStatus,
		stableEdit,
		stableToggleReaction,
		stableAddComment,
		stableUpdateComment,
		stableDeleteComment,
		composer,
	} = usePinnwandPage();

	const unknownAuthor = { name: tCommon('unknownPerson'), color: null };

	function renderCard(a: Announcement): React.ReactElement {
		return (
			<AnnouncementCard
				key={`${identity.memberId}:${a.id}`}
				announcement={a}
				author={authorByMemberId.get(a.authorMemberId) ?? unknownAuthor}
				deletePending={isPending(a.id)}
				pinPending={isPending(`${a.id}:pin`)}
				statusPending={isPending(`${a.id}:status`)}
				pendingReactions={ANNOUNCEMENT_REACTIONS.filter((reaction) =>
					isPending(`${a.id}:reaction:${reaction}`),
				).join()}
				onDelete={stableDelete}
				onTogglePinned={stableTogglePinned}
				onToggleStatus={stableToggleStatus}
				onEdit={stableEdit}
				onToggleReaction={stableToggleReaction}
				onAddComment={stableAddComment}
				onUpdateComment={stableUpdateComment}
				onDeleteComment={stableDeleteComment}
				currentMemberId={identity.memberId}
				isAdmin={isAdmin}
				shareCode={wg.shareCode}
				highlighted={highlightedId === a.id}
			/>
		);
	}

	return (
		<div data-exchange-content className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<SubNav />
			<h1 className="sr-only">{t('title')}</h1>

			{newCount > 0 && (
				<Button
					type="button"
					onClick={applyPendingItems}
					variant="secondary"
					className="w-full"
					aria-live="polite"
				>
					{t('newPosts', { count: newCount })}
				</Button>
			)}
			{queuedCount > 0 && (
				<Alert>
					<AlertDescription>{t('queued', { count: queuedCount })}</AlertDescription>
				</Alert>
			)}
			{loadError && (
				<LoadErrorBanner
					message={loadError}
					onRetry={() => void load()}
					busy={refreshing}
					retryLabel={t('reload')}
				/>
			)}
			{myOpenItems.length > 0 && (
				<MyOpenAnnouncements
					items={myOpenItems}
					onSelect={(id) => {
						window.history.replaceState(window.history.state, '', getAnnouncementHash(id));
						scrollToAnnouncement(id);
					}}
				/>
			)}

			<PinnwandComposer
				open={composer.open}
				finalFocusRef={composer.buttonRef}
				authorName={identity.name}
				submitting={composer.submitting}
				kind={composer.kind}
				onKindChange={composer.setKind}
				content={composer.content}
				onContentChange={composer.setContent}
				textareaRef={composer.textareaRef}
				imageUrl={composer.imageUrl}
				onImageUrlChange={composer.setImageUrl}
				shareCode={wg.shareCode}
				error={composer.error}
				onClose={composer.close}
				onSubmit={composer.submit}
			/>

			{notice && (
				<Alert aria-live="polite">
					<AlertDescription>{render(notice)}</AlertDescription>
				</Alert>
			)}

			{showSkeleton ? (
				<AnnouncementSkeleton />
			) : loadError && items.length === 0 ? (
				<EmptyState icon={Megaphone} hint={t('notLoadedHint')}>
					{t('notLoadedTitle')}
				</EmptyState>
			) : items.length === 0 ? (
				<EmptyState icon={Megaphone} hint={t('emptyHint')}>
					{t('emptyTitle')}
				</EmptyState>
			) : (
				<>
					{openItems.length === 0 ? (
						<EmptyState icon={Megaphone} hint={t('nothingOpenHint')}>
							{t('nothingOpenTitle')}
						</EmptyState>
					) : (
						<ul
							className="flex flex-col divide-y overflow-hidden rounded-xl border"
							aria-label={t('listAria')}
						>
							{openItems.slice(0, visibleOpenCount).map(renderCard)}
						</ul>
					)}
					{visibleOpenCount < openItems.length && (
						<Button variant="outline" onClick={showMoreOpen}>
							{t('showMore', { count: String(openItems.length - visibleOpenCount) })}
						</Button>
					)}
				</>
			)}
			<ThumbAction>
				<Button
					ref={composer.buttonRef}
					type="button"
					className="relative min-h-11 w-full"
					disabled={composer.submitting}
					onClick={() => {
						composer.setOpen(true);
						setNotice(null);
					}}
				>
					<Plus data-icon="inline-start" aria-hidden />
					{composer.hasDraft ? t('continueDraft') : t('addPost')}
					{composer.hasDraft && (
						<span
							aria-hidden
							className="absolute top-1 right-1 size-2.5 rounded-full bg-primary-foreground ring-2 ring-primary"
						/>
					)}
				</Button>
			</ThumbAction>
		</div>
	);
}

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnnouncementCard } from './AnnouncementCard';
import type { Announcement } from './announcement-types';

function buildAnnouncement(overrides: Partial<Announcement> = {}): Announcement {
	return {
		id: 'ann-1',
		authorMemberId: 'member-1',
		content: 'Bitte Müll rausbringen',
		imageUrl: null,
		kind: 'info',
		status: 'open',
		source: 'manual',
		sourcePath: null,
		pinnedAt: null,
		resolvedAt: null,
		resolvedByMemberId: null,
		createdAt: new Date().toISOString(),
		reactionCounts: {},
		myReactions: [],
		takers: [],
		comments: [
			{
				id: 'comment-1',
				announcementId: 'ann-1',
				memberId: 'member-1',
				content: 'Alter Kommentartext',
				createdAt: new Date().toISOString(),
				authorName: 'Anna',
				authorColor: null,
			},
		],
		...overrides,
	};
}

function renderCard(announcement: Announcement) {
	return render(
		<ul>
			<AnnouncementCard
				announcement={announcement}
				author={{ name: 'Anna', color: null }}
				deletePending={false}
				pinPending={false}
				statusPending={false}
				reactionPending={() => false}
				compact={false}
				onDelete={vi.fn()}
				onTogglePinned={vi.fn()}
				onToggleStatus={vi.fn()}
				onToggleReaction={vi.fn()}
				onAddComment={vi.fn().mockResolvedValue(true)}
				onUpdateComment={vi.fn().mockResolvedValue(true)}
				onDeleteComment={vi.fn().mockResolvedValue(true)}
				currentMemberId="member-1"
				shareCode="test-wg"
				highlighted={false}
			/>
		</ul>,
	);
}

describe('AnnouncementCard comment editing', () => {
	it('shows the latest comment content when reopening the edit form after an external update', () => {
		const announcement = buildAnnouncement();
		const { rerender } = renderCard(announcement);

		const originalComment = announcement.comments[0];
		if (!originalComment) throw new Error('expected buildAnnouncement to seed a comment');
		const updated = buildAnnouncement({
			comments: [{ ...originalComment, content: 'Neuer Kommentartext von woanders' }],
		});
		rerender(
			<ul>
				<AnnouncementCard
					announcement={updated}
					author={{ name: 'Anna', color: null }}
					deletePending={false}
					pinPending={false}
					statusPending={false}
					reactionPending={() => false}
					compact={false}
					onDelete={vi.fn()}
					onTogglePinned={vi.fn()}
					onToggleStatus={vi.fn()}
					onToggleReaction={vi.fn()}
					onAddComment={vi.fn().mockResolvedValue(true)}
					onUpdateComment={vi.fn().mockResolvedValue(true)}
					onDeleteComment={vi.fn().mockResolvedValue(true)}
					currentMemberId="member-1"
					shareCode="test-wg"
					highlighted={false}
				/>
			</ul>,
		);

		fireEvent.click(screen.getByRole('button', { name: /Kommentar bearbeiten/ }));

		expect(screen.getByLabelText('Kommentar bearbeiten')).toHaveValue(
			'Neuer Kommentartext von woanders',
		);
	});
});

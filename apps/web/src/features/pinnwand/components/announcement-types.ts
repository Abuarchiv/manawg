// Re-exported, not re-declared: announcement-workflow derives these from the
// ANNOUNCEMENT_KINDS / ANNOUNCEMENT_SOURCES constants the API validates
// against. A hand-written second copy silently disagrees the moment a kind is
// added there.
export type {
	AnnouncementKind,
	AnnouncementSource,
	AnnouncementStatus,
} from '@/features/pinnwand/announcement-workflow';
import type {
	AnnouncementKind,
	AnnouncementSource,
	AnnouncementStatus,
} from '@/features/pinnwand/announcement-workflow';
export type ReactionKey = 'seen' | 'take' | 'ok';

export interface Announcement {
	id: string;
	authorMemberId: string;
	content: string;
	imageUrl: string | null;
	kind: AnnouncementKind;
	status: AnnouncementStatus;
	source: AnnouncementSource;
	sourcePath: string | null;
	pinnedAt: string | null;
	resolvedAt: string | null;
	resolvedByMemberId: string | null;
	createdAt: string;
	updatedAt?: string;
	reactionCounts: Partial<Record<ReactionKey, number>>;
	myReactions: ReactionKey[];
	takers: AnnouncementTaker[];
	comments: AnnouncementComment[];
}

interface AnnouncementTaker {
	memberId: string;
	name: string;
	color: string | null;
}

export interface AnnouncementComment {
	id: string;
	announcementId: string;
	memberId: string;
	content: string;
	createdAt: string;
	authorName: string;
	authorColor: string | null;
}

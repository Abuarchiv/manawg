import type { MutableRefObject } from 'react';
import type { useToast } from '@/components/ui/Toast';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import type { SessionMember } from '@/core/auth/local-account';
import type { NotificationWarning } from '@/core/notifications/notification-warning';
import type {
	Announcement,
	AnnouncementComment,
	ReactionKey,
} from '@/features/pinnwand/components/announcement-types';
import type { Message } from '@/shared/i18n/message';

/** What the Pinnwand mutation hooks share: who acts, where results go, and the loaded board. */
export interface AnnouncementPageContext {
	wg: Pick<WgSummary, 'id' | 'shareCode'>;
	identity: SessionMember;
	members: Member[];
	toast: ReturnType<typeof useToast>;
	encodedShareCode: string;
	isPending: (id: string) => boolean;
	start: (id: string) => void;
	end: (id: string) => void;
	setActionError: (message: Message | null) => void;
	setNotice: (message: Message | null) => void;
	itemsRef: MutableRefObject<Announcement[]>;
	commitItems: (nextItems: Announcement[]) => void;
	load: (mode?: 'replace' | 'background') => Promise<void>;
	refreshCount: () => void;
}

export type AnnouncementWriteResponse = {
	announcement: Announcement;
	warning: NotificationWarning;
};

export type AnnouncementReactionResponse = {
	reaction: ReactionKey;
	active: boolean;
	warning: NotificationWarning;
};

export type AnnouncementCommentResponse = {
	comment: AnnouncementComment;
	warning: NotificationWarning;
};

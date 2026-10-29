import { previewBody } from '@/core/utils/preview-body';

const PUSH_TITLE_MAX = 120;

/** Push title of a pinboard event: one line, cut by code point so an emoji is never split. */
export function announcementPushTitle(content: string): string {
	return previewBody(content, PUSH_TITLE_MAX);
}

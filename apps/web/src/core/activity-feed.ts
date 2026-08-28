import { announcements, db } from '@/core/db';

export interface SystemNoticeInput {
	wgId: string;
	authorMemberId: string;
	kind: 'info' | 'request';
	source: 'expense' | 'shopping' | 'system';
	content: string;
	sourcePath?: string;
}

/**
 * Cross-feature system notices land on the pinnwand feed, but posting one is
 * an infrastructural side effect (like an audit event), not pinnwand business
 * logic — so it lives here in core rather than in features/pinnwand, which
 * would force every other feature to import across the feature boundary.
 *
 * Best-effort: a failure here must never undo the action that triggered it,
 * so callers don't need their own try/catch — this swallows and logs.
 */
export async function postSystemNotice(input: SystemNoticeInput): Promise<void> {
	try {
		await db.insert(announcements).values({
			wgId: input.wgId,
			authorMemberId: input.authorMemberId,
			kind: input.kind,
			source: input.source,
			sourcePath: input.sourcePath,
			content: input.content,
		});
	} catch (err) {
		console.warn(`[activity-feed] system notice from "${input.source}" failed`, err);
	}
}

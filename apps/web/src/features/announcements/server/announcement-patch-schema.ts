import 'server-only';
import { z } from 'zod';
import { ANNOUNCEMENT_KINDS } from '@/features/announcements/announcement-workflow';
import { CONTENT_MAX } from '@/features/announcements/constants';

/** PATCH body of one announcement. Strict and non-empty: an empty patch would still touch updatedAt and the audit log. */
export const patchAnnouncementSchema = z
	.object({
		status: z.enum(['open', 'resolved']).optional(),
		pinned: z.boolean().optional(),
		kind: z.enum(ANNOUNCEMENT_KINDS).optional(),
		content: z.string().trim().min(1).max(CONTENT_MAX).optional(),
		// The version the edit drawer was opened on; a newer one means someone saved meanwhile.
		expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
	})
	.strict()
	.refine((value) =>
		Object.entries(value).some(
			([key, field]) => key !== 'expectedUpdatedAt' && field !== undefined,
		),
	);

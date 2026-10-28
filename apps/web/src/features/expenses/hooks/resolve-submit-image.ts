import { isPendingImageToken, uploadPendingImageToken } from '@/core/offline/offline-images';
import type { Message } from '@/shared/i18n/message';

export const RECEIPT_UPLOAD_FAILED: Message = { key: 'expenses-form.notices.receiptUploadFailed' };

/**
 * The image to send with a save. Submit is disabled while an upload runs, so a pending token
 * here online belongs to an upload that failed earlier and is retried now; offline the token
 * stays and the replay uploads it. `null` means the retry failed.
 */
export async function resolveSubmitImage(
	imageUrl: string | null,
	memberId: string,
	online: boolean,
	upload = uploadPendingImageToken,
): Promise<{ url: string | null } | null> {
	if (!imageUrl || !isPendingImageToken(imageUrl) || !online) return { url: imageUrl };
	try {
		return { url: await upload(imageUrl, memberId) };
	} catch {
		return null;
	}
}

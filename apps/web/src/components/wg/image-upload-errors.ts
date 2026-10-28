import type { Message } from '@/shared/i18n/message';

export const MISSING_PENDING_IMAGE: Message = { key: 'shell.upload.missingPending' };

const FAILED: Message = { key: 'shell.upload.failed' };
const GENERIC_SIGN_ERROR: Message = { key: 'shell.upload.failedRetry' };

function failedBecause(detail: Message): Message {
	return { key: 'common.errors.withSubject', values: { subject: FAILED, detail } };
}

export function uploadSignErrorMessage(status: number, error: string): Message {
	if (status === 404 || error === 'wg_not_found') {
		return failedBecause({ key: 'common.errors.wgUnavailable' });
	}
	if (error === 'invalid_share_code') {
		return failedBecause({ key: 'common.errors.invalidShareCode' });
	}
	if (status === 401 || error === 'not_a_member') {
		return failedBecause({ key: 'common.errors.authInvalidated' });
	}
	if (error === 'invalid_file') return failedBecause({ key: 'shell.upload.invalidFile' });
	if (error === 'invalid_mime_type') return failedBecause({ key: 'shell.upload.invalidType' });
	if (error === 'file_too_large') return failedBecause({ key: 'shell.upload.tooLarge' });
	if (error === 'feature_disabled' || error === 'image_uploads_unavailable') {
		return { key: 'shell.upload.notConfigured' };
	}
	if (status === 429 || error === 'upload_sign_rate_limited') {
		return { key: 'shell.upload.rateLimited' };
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return failedBecause({ key: 'shell.upload.invalidRequest' });
	}
	return GENERIC_SIGN_ERROR;
}

/** Copy for a failed background upload of a pending image; null means retry silently. */
export function pendingUploadErrorMessage(error: unknown): Message | null {
	if (!(error instanceof Error)) return null;
	if (isRejectedPendingUpload(error)) return failedBecause({ key: 'shell.upload.rejected' });
	const match = /^sign-failed:(\d+)(?::(.+))?$/.exec(error.message);
	if (!match) return null;
	const status = Number(match[1]);
	const message = uploadSignErrorMessage(status, match[2] ?? '');
	if (status >= 500 && message === GENERIC_SIGN_ERROR) return null;
	return message;
}

/** The storage answered the PUT with a 4xx that a retry cannot fix (not a timeout or rate limit). */
export function isRejectedPendingUpload(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const match = /^upload-failed:(\d+)$/.exec(error.message);
	if (!match) return false;
	const status = Number(match[1]);
	return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

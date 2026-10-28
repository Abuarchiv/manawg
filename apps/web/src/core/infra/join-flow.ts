import { AUTH_RATE_LIMITED_MESSAGE } from '@/core/auth/password-errors';
import type { Message } from '@/shared/i18n/message';

export const INVITE_EXPIRED_MESSAGE: Message = { key: 'entry.errors.inviteExpired' };
export const DELETION_PENDING_MESSAGE: Message = { key: 'entry.errors.deletionPending' };

export function joinErrorMessage(status: number, error: string): Message {
	if (status === 429) return AUTH_RATE_LIMITED_MESSAGE;
	if (error === 'account_deletion_pending') return DELETION_PENDING_MESSAGE;
	if (error === 'invite_expired' || error === 'invite_invalid' || error === 'invite_required') {
		return INVITE_EXPIRED_MESSAGE;
	}
	if (status === 404 || error === 'wg_not_found') return { key: 'entry.errors.wgNotFound' };
	if (status === 409 && error === 'name_taken') return { key: 'entry.errors.nameTaken' };
	if (status === 409 && error === 'member_limit_reached') return { key: 'entry.errors.full' };
	if (error === 'member_deactivated') return { key: 'entry.errors.deactivated' };
	if (error === 'insert_failed') return { key: 'entry.errors.joinInsertFailed' };
	if (
		status >= 500 ||
		error === 'server_error' ||
		error === 'unexpected_error' ||
		error === 'db_error'
	) {
		return { key: 'entry.errors.joinRetry' };
	}
	if (error === 'name_invalid') return { key: 'entry.errors.nameInvalid' };
	if (status === 400) return { key: 'entry.errors.checkInput' };
	if (status === 0) return { key: 'entry.errors.joinOffline' };
	return { key: 'entry.errors.joinFailed' };
}

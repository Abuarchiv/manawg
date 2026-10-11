import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';

/** Spots an old-style share code in pasted text or a link; '' when none is found. */
export function extractInviteCode(text: string): string {
	const match = /[?&]code=([A-Za-z0-9]+)/.exec(text) ?? /\bCode\s+([A-Za-z0-9]{8})\b/.exec(text);
	const code = normalizeShareCode(match?.[1] ?? '');
	return isValidShareCode(code) ? code : '';
}

export const LEGACY_CODE_MESSAGE =
	'Ein WG-Code reicht nicht mehr. Lass dir einen Einladungslink schicken.';
export const INVITE_EXPIRED_MESSAGE =
	'Diese Einladung ist abgelaufen. Bitte ein Mitglied um eine neue.';
const RATE_LIMITED_MESSAGE =
	'Zu viele Versuche. Bitte warte einige Minuten und versuche es dann erneut.';
export const DELETION_PENDING_MESSAGE =
	'Dein Konto wird gerade gelöscht. Neue WGs oder Beitritte sind nicht mehr möglich.';

export function joinErrorMessage(status: number, error: string): string {
	if (status === 429) return RATE_LIMITED_MESSAGE;
	if (error === 'account_deletion_pending') return DELETION_PENDING_MESSAGE;
	if (error === 'invite_expired' || error === 'invite_invalid' || error === 'invite_required') {
		return INVITE_EXPIRED_MESSAGE;
	}
	if (status === 404 || error === 'wg_not_found') return 'Diese WG gibt es nicht.';
	if (status === 409 && error === 'name_taken') return 'Der Name ist in dieser WG schon vergeben.';
	if (status === 409 && error === 'member_limit_reached') return 'Diese WG ist schon voll.';
	if (error === 'member_deactivated') {
		return 'Du bist in dieser WG als ausgezogen markiert. Eine Admin-Person kann dich wieder aktivieren.';
	}
	if (error === 'insert_failed') {
		return 'Beitritt konnte nicht gespeichert werden: Prüfe die WG und versuche es erneut.';
	}
	if (
		status >= 500 ||
		error === 'server_error' ||
		error === 'unexpected_error' ||
		error === 'db_error'
	) {
		return 'Beitritt konnte nicht abgeschlossen werden: Versuche es gleich erneut.';
	}
	if (error === 'name_invalid') {
		return 'Dein Name muss 1 bis 80 Zeichen haben.';
	}
	if (status === 400) return 'Bitte prüfe deine Eingabe.';
	if (status === 0) {
		return 'Beitritt konnte nicht abgeschlossen werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	return 'Der Beitritt hat nicht geklappt. Bitte versuche es noch einmal.';
}

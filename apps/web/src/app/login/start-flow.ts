/**
 * Pure helpers for the start flow (`/login`): draft shape, URL intent parsing,
 * and mapping API errors to messages and the field to focus.
 */
import type { SocialProvider } from '@/components/auth/SocialLoginButtons';
import { safeNextPath } from '@/core/auth/next-path';
import { DELETION_PENDING_MESSAGE } from '@/core/infra/join-flow';
import { extractInviteToken, isInviteToken } from '@/core/utils/invite-token';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';

import type { Message } from '@/shared/i18n/message';
import { MEMBER_NAME_MAX_LENGTH, WG_NAME_MAX_LENGTH } from '@/shared/lib/limits';

export const WG_NAME_MAX = WG_NAME_MAX_LENGTH;
export const NAME_MAX = MEMBER_NAME_MAX_LENGTH;
export const START_DRAFT_KEY = 'manawg:draft:neu';

export interface CreateResponse {
	wg: { id: string; shareCode: string; name: string };
	creator: { id: string; name: string };
}

export interface CreatedWg {
	code: string;
	name: string;
	/** The creator's member, needed to authorise the first invitation request. */
	memberId: string;
}

export type StartStep = 'choose' | 'create' | 'join' | 'invite';
export type StartField = 'wgName' | 'creatorName' | 'inviteLink';

export function getWgCodeFromPath(path: string): string | null {
	const match = path.match(/^\/wg\/([^/]+)/);
	if (!match?.[1]) return null;
	try {
		const code = normalizeShareCode(decodeURIComponent(match[1]));
		return isValidShareCode(code) ? code : null;
	} catch {
		return null;
	}
}

export function getLoginIntentFromSearch(search: string): { inviteToken: string; create: boolean } {
	const currentSearch = search.startsWith('?') ? search : `?${search}`;
	const nested = safeNextPath(new URLSearchParams(currentSearch).get('next'));
	for (const candidate of [currentSearch, nested]) {
		const url = new URL(candidate, 'https://manawg.invalid/login');
		if (url.pathname !== '/login') continue;
		const inviteToken = url.searchParams.get('invite') ?? '';
		if (isInviteToken(inviteToken)) return { inviteToken, create: false };
		if (url.searchParams.get('action') === 'create') return { inviteToken: '', create: true };
	}
	return { inviteToken: '', create: false };
}

/** What a pasted invitation (link or bare token) leads to: the token, or the reason it fails. */
export function resolveInviteInput(text: string): { token: string } | { error: Message } {
	const token = extractInviteToken(text);
	if (token) return { token };
	return { error: { key: 'entry.errors.notAnInviteLink' } };
}

// Only a fresh sign-in skips the WG picker; a deliberate visit to /login (second WG) keeps it.
const JUST_SIGNED_IN_KEY = 'manawg:just-signed-in';

export function markJustSignedIn(): void {
	try {
		sessionStorage.setItem(JUST_SIGNED_IN_KEY, '1');
	} catch {
		// Without storage the user simply sees the picker.
	}
}

export function consumeJustSignedIn(): boolean {
	try {
		const value = sessionStorage.getItem(JUST_SIGNED_IN_KEY);
		sessionStorage.removeItem(JUST_SIGNED_IN_KEY);
		return value === '1';
	} catch {
		return false;
	}
}

export async function startSocialLogin(provider: SocialProvider, next: string): Promise<void> {
	markJustSignedIn();
	const { startSocialLogin } = await import('@/core/auth/client');
	await startSocialLogin(provider, next);
}

export interface StartDraft extends Record<string, unknown> {
	step?: StartStep;
	wgName?: string;
	creatorName?: string;
}

export function createWgErrorMessage(status: number, error: string): Message {
	if (status === 429) return { key: 'entry.errors.createRateLimited' };
	if (error === 'account_deletion_pending') return DELETION_PENDING_MESSAGE;
	if (status === 401 && error === 'auth_required') return { key: 'entry.errors.signInFirst' };
	if (status === 400 && error === 'name_invalid') {
		return { key: 'entry.errors.wgNameInvalid', values: { max: WG_NAME_MAX } };
	}
	if (status === 400 && error === 'creator_name_invalid') {
		return { key: 'entry.errors.creatorNameInvalid', values: { max: NAME_MAX } };
	}
	if (status === 400 && (error === 'invalid_body' || error === 'invalid_json')) {
		return { key: 'entry.errors.invalidBody' };
	}
	if (error === 'share_code_exhausted') {
		return { key: 'entry.errors.codeExhausted' };
	}
	if (error === 'insert_failed' || error === 'member_insert_failed') {
		return { key: 'entry.errors.createInsertFailed' };
	}
	if (
		status >= 500 ||
		error === 'server_error' ||
		error === 'unexpected_error' ||
		error === 'db_error'
	) {
		return { key: 'entry.errors.createRetry' };
	}
	return { key: 'entry.errors.createFailed' };
}

export function createWgErrorField(status: number, error: string): StartField | null {
	if (status === 400 && error === 'name_invalid') return 'wgName';
	if (status === 400 && error === 'creator_name_invalid') return 'creatorName';
	return null;
}

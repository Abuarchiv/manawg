'use client';

import { safeLocalStorage } from '@/core/utils/browser';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { z } from 'zod';
import { MEMBER_NAME_MAX_LENGTH, WG_NAME_MAX_LENGTH } from './limits';
import {
	EXPECTED_MEMBER_ID_HEADER,
	LEGACY_CLAIM_MEMBER_ID_HEADER,
	LEGACY_CLAIM_TOKEN_HEADER,
} from './member-header';

const STORAGE_PREFIX = 'manawg_identity:';
const KNOWN_WGS_KEY = 'manawg_known_wgs';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const storedIdentitySchema = z.object({
	memberId: z.string().regex(UUID_V4_PATTERN, 'memberId must be a valid UUID v4'),
	name: z.string().min(1).max(MEMBER_NAME_MAX_LENGTH),
	// Used only to keep local offline records separated when this browser switches accounts.
	authUserId: z.string().regex(UUID_V4_PATTERN).optional(),
	// Legacy-profile recovery proof (see @/core/guards/legacy-claim-proof). Only
	// read by getLegacyIdentityCandidates; normal API access never sends it.
	memberToken: z.string().min(1).optional(),
});

// Same limit as POST/PATCH /api/wg: a shorter one would silently drop long
// names on read and hide them from the offline page.
const knownWgSchema = z.object({
	code: z.string(),
	name: z.string().min(1).max(WG_NAME_MAX_LENGTH),
	lastVisitedAt: z.number().finite(),
});

/** Member-context header for plain `fetch` calls outside `apiFetch` (downloads, WG delete). */
export function memberContextHeader(memberId: string): Record<string, string> {
	return { [EXPECTED_MEMBER_ID_HEADER]: memberId };
}

/** Proof headers for the explicit legacy claim endpoint; Supabase owns normal access control. */
export function legacyClaimHeaders(candidate: LegacyIdentityCandidate): Record<string, string> {
	return {
		[LEGACY_CLAIM_MEMBER_ID_HEADER]: candidate.memberId,
		[LEGACY_CLAIM_TOKEN_HEADER]: candidate.memberToken,
	};
}

export interface StoredIdentity {
	memberId: string;
	name: string;
	authUserId?: string;
}

export interface LegacyIdentityCandidate {
	wgId: string;
	memberId: string;
	memberToken: string;
}

export interface KnownWg {
	code: string;
	name: string;
	lastVisitedAt: number;
}

export function getIdentity(wgId: string): StoredIdentity | null {
	const ls = safeLocalStorage();
	if (!ls) return null;
	try {
		const raw = ls.getItem(STORAGE_PREFIX + wgId);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		const result = storedIdentitySchema.safeParse(parsed);
		if (!result.success) return null;
		const { memberId, name, authUserId } = result.data;
		return { memberId, name, ...(authUserId ? { authUserId } : {}) };
	} catch {
		return null;
	}
}

export function setIdentity(wgId: string, identity: StoredIdentity): void {
	const ls = safeLocalStorage();
	if (!ls) return;
	const parsed = storedIdentitySchema.safeParse(identity);
	if (!parsed.success) return;
	try {
		ls.setItem(STORAGE_PREFIX + wgId, JSON.stringify(parsed.data));
	} catch {
		// Local account binding is a convenience; server checks remain authoritative.
	}
}

/**
 * Read token-bearing legacy identities only when an explicit recovery flow
 * asks for them. Names are intentionally not returned to recovery callers.
 */
export function getLegacyIdentityCandidates(): LegacyIdentityCandidate[] {
	const ls = safeLocalStorage();
	if (!ls) return [];

	const candidates: LegacyIdentityCandidate[] = [];
	try {
		for (let index = 0; index < ls.length; index += 1) {
			const key = ls.key(index);
			if (!key?.startsWith(STORAGE_PREFIX)) continue;
			const wgId = key.slice(STORAGE_PREFIX.length);
			if (!UUID_V4_PATTERN.test(wgId)) continue;

			try {
				const raw = ls.getItem(key);
				if (!raw) continue;
				const parsed = storedIdentitySchema.safeParse(JSON.parse(raw));
				if (!parsed.success || !parsed.data.memberToken) continue;
				candidates.push({
					wgId,
					memberId: parsed.data.memberId,
					memberToken: parsed.data.memberToken,
				});
			} catch {
				// Ignore malformed or inaccessible legacy entries.
			}
		}
	} catch {
		// Storage may become inaccessible between individual reads.
	}
	return candidates;
}

/**
 * True, wenn auf diesem Gerät eine Identität liegt, die zum angemeldeten Konto passt
 * (oder aus der Zeit vor der Konto-Bindung stammt). Die Offline-Seite bietet dann die
 * gemerkten WGs an, auch ohne wartende Aktionen.
 */
export function hasLocalIdentityFor(authUserId: string | null): boolean {
	const ls = safeLocalStorage();
	if (!ls) return false;
	try {
		for (let index = 0; index < ls.length; index += 1) {
			const key = ls.key(index);
			if (!key?.startsWith(STORAGE_PREFIX)) continue;
			const identity = getIdentity(key.slice(STORAGE_PREFIX.length));
			if (identity && (!identity.authUserId || identity.authUserId === authUserId)) return true;
		}
	} catch {
		// Storage may become inaccessible between individual reads.
	}
	return false;
}

export function clearIdentity(wgId: string): void {
	const ls = safeLocalStorage();
	if (!ls) return;
	try {
		ls.removeItem(STORAGE_PREFIX + wgId);
	} catch {
		// Blocked storage: nothing stored, nothing to clear.
	}
}

const MAX_KNOWN_WGS = 20;

export function getKnownWgs(): KnownWg[] {
	const ls = safeLocalStorage();
	if (!ls) return [];
	try {
		const raw = ls.getItem(KNOWN_WGS_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const seen = new Set<string>();
		const known: KnownWg[] = [];
		for (const item of parsed) {
			const result = knownWgSchema.safeParse(item);
			if (!result.success) continue;
			const code = normalizeShareCode(result.data.code);
			if (!isValidShareCode(code) || seen.has(code)) continue;
			seen.add(code);
			known.push({ ...result.data, code });
			if (known.length >= MAX_KNOWN_WGS) break;
		}
		return known;
	} catch {
		return [];
	}
}

export function rememberWg(entry: KnownWg): void {
	const ls = safeLocalStorage();
	if (!ls) return;
	const code = normalizeShareCode(entry.code);
	if (!isValidShareCode(code) || entry.name.trim().length === 0) return;
	const normalizedEntry = { ...entry, code, name: entry.name.trim() };
	const existing = getKnownWgs().filter((w) => w.code !== code);
	const next = [normalizedEntry, ...existing].slice(0, MAX_KNOWN_WGS);
	try {
		ls.setItem(KNOWN_WGS_KEY, JSON.stringify(next));
	} catch {
		// Remembering recent WGs is a convenience; blocked storage must not block the WG.
	}
}

export function forgetWg(code: string): void {
	const ls = safeLocalStorage();
	if (!ls) return;
	const normalizedCode = normalizeShareCode(code);
	const filtered = getKnownWgs().filter((w) => w.code !== normalizedCode);
	try {
		ls.setItem(KNOWN_WGS_KEY, JSON.stringify(filtered));
	} catch {
		// Best-effort cleanup only.
	}
}

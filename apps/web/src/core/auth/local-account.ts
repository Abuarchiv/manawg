'use client';

import { safeLocalStorage } from '@/core/utils/browser';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import { WG_NAME_MAX_LENGTH } from '@/shared/lib/limits';
import { z } from 'zod';

/**
 * What this browser remembers about the signed-in account, only for the offline page and the
 * offline replay. The login is the source of truth; the WG page loads its member from the
 * server.
 */

const ACCOUNT_KEY = 'manawg_account';
const KNOWN_WGS_KEY = 'manawg_known_wgs';
const MAX_KNOWN_WGS = 20;

/** The member the signed-in account has in the open WG, resolved by the server and never persisted. */
export interface SessionMember {
	memberId: string;
	name: string;
	/** Absent only in the sessionless Playwright build. */
	authUserId?: string;
}

// Same limit as POST/PATCH /api/wg: a shorter one would silently drop long
// names on read and hide them from the offline page.
const knownWgSchema = z.object({
	code: z.string(),
	name: z.string().min(1).max(WG_NAME_MAX_LENGTH),
	lastVisitedAt: z.number().finite(),
	// Missing on entries written before account binding.
	authUserId: z.string().min(1).optional(),
});

export type KnownWg = z.infer<typeof knownWgSchema>;

/** The account this browser last loaded a member for, or null before the first member load. */
export function getLocalAccount(): string | null {
	try {
		return safeLocalStorage()?.getItem(ACCOUNT_KEY) || null;
	} catch {
		return null;
	}
}

/**
 * Records the signed-in account. When it replaces a different one, the remembered WGs of the old
 * account are dropped and the old account id is returned so the caller can drop its queue too.
 */
export function setLocalAccount(authUserId: string): string | null {
	const ls = safeLocalStorage();
	if (!ls) return null;
	const previous = getLocalAccount();
	if (previous === authUserId) return null;
	try {
		ls.setItem(ACCOUNT_KEY, authUserId);
	} catch {
		return null;
	}
	if (!previous) return null;
	writeKnownWgs(getKnownWgs().filter((wg) => wg.authUserId === authUserId));
	return previous;
}

/**
 * True when local data tagged with `owner` belongs to the signed-in account. Data from before
 * account binding (no owner) counts for the one account recorded on this device.
 */
export function belongsToAccount(owner: string | undefined, authUserId: string | null): boolean {
	return Boolean(authUserId) && (owner ?? getLocalAccount()) === authUserId;
}

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

function writeKnownWgs(list: KnownWg[]): void {
	try {
		safeLocalStorage()?.setItem(KNOWN_WGS_KEY, JSON.stringify(list));
	} catch {
		// Remembering recent WGs is a convenience; blocked storage must not block the WG.
	}
}

export function rememberWg(entry: KnownWg): void {
	const code = normalizeShareCode(entry.code);
	if (!isValidShareCode(code) || entry.name.trim().length === 0) return;
	const existing = getKnownWgs().filter((w) => w.code !== code);
	writeKnownWgs([{ ...entry, code, name: entry.name.trim() }, ...existing].slice(0, MAX_KNOWN_WGS));
}

export function forgetWg(code: string): void {
	const normalizedCode = normalizeShareCode(code);
	writeKnownWgs(getKnownWgs().filter((w) => w.code !== normalizedCode));
}

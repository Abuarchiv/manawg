import { and, eq, ne, sql } from 'drizzle-orm';
import { wgMembers } from './schema';
import { LIMITS } from './schema';
import type { DbTransaction } from './transaction';

/** Active members one WG may have; moved-out members do not count. */
export const MAX_MEMBERS_PER_WG = 20;

const MOVED_OUT_SUFFIX = ' (ausgezogen)';

/**
 * A free name for a moved-out member whose name a current member wants: "Anna" becomes
 * "Anna (ausgezogen)", numbered when that is taken, and shortened so it still fits the limit.
 */
function movedOutName(base: string, taken: ReadonlySet<string>): string {
	for (let attempt = 1; attempt < 1000; attempt += 1) {
		const suffix = attempt === 1 ? MOVED_OUT_SUFFIX : ` (ausgezogen ${attempt})`;
		const candidate = `${base.slice(0, Math.max(1, LIMITS.NAME_MAX - suffix.length))}${suffix}`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
	return `${base.slice(0, 20)} ${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Makes `name` free inside the WG: another active member with that name (compared without
 * regard to case) blocks it; a moved-out member with it is renamed out of the way so a person
 * who left does not keep their name from the people who live there now.
 */
export async function releaseMemberName(
	tx: DbTransaction,
	wgId: string,
	name: string,
	exceptMemberId?: string,
): Promise<boolean> {
	const clashes = await tx
		.select({ id: wgMembers.id, name: wgMembers.name, deactivatedAt: wgMembers.deactivatedAt })
		.from(wgMembers)
		.where(
			and(
				eq(wgMembers.wgId, wgId),
				sql`lower(${wgMembers.name}) = lower(${name})`,
				exceptMemberId ? ne(wgMembers.id, exceptMemberId) : undefined,
			),
		);
	if (clashes.some((clash) => clash.deactivatedAt === null)) return false;
	if (clashes.length === 0) return true;
	const roster = await tx
		.select({ name: wgMembers.name })
		.from(wgMembers)
		.where(eq(wgMembers.wgId, wgId));
	const taken = new Set(roster.map((row) => row.name.toLowerCase()));
	for (const clash of clashes) {
		const next = movedOutName(clash.name, taken);
		taken.add(next.toLowerCase());
		await tx.update(wgMembers).set({ name: next }).where(eq(wgMembers.id, clash.id));
	}
	return true;
}

/** The first name based on `base` that no member of the WG uses, numbered ("Anna (2)") when taken. */
export async function availableMemberName(
	tx: DbTransaction,
	wgId: string,
	base: string,
): Promise<string> {
	const roster = await tx
		.select({ name: wgMembers.name })
		.from(wgMembers)
		.where(eq(wgMembers.wgId, wgId));
	const taken = new Set(roster.map((row) => row.name.toLowerCase()));
	if (!taken.has(base.toLowerCase())) return base;
	for (let attempt = 2; attempt < 1000; attempt += 1) {
		const suffix = ` (${attempt})`;
		const candidate = `${base.slice(0, Math.max(1, LIMITS.NAME_MAX - suffix.length))}${suffix}`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
	return `${base.slice(0, 20)} ${crypto.randomUUID().slice(0, 8)}`;
}

import { eq } from 'drizzle-orm';
import { db, wgs } from './index';
import { wgChangeVersions } from './schema-change-versions';

/** `GET /api/wg/[code]/changes`: transaction ids as strings, compared for equality only. */
export interface WgChangeVersions {
	data: string;
	members: string;
	chat: string;
}

const versionColumns = {
	data: wgChangeVersions.dataVersion,
	members: wgChangeVersions.membersVersion,
	chat: wgChangeVersions.chatVersion,
};

function toVersions(
	row: { data: number | null; members: number | null; chat: number | null } | undefined,
): WgChangeVersions {
	return {
		data: String(row?.data ?? 0),
		members: String(row?.members ?? 0),
		chat: String(row?.chat ?? 0),
	};
}

/** A WG's change versions; a WG nothing was written to yet has none and reads as all `'0'`. */
export async function readWgChangeVersions(wgId: string): Promise<WgChangeVersions> {
	const [row] = await db
		.select(versionColumns)
		.from(wgChangeVersions)
		.where(eq(wgChangeVersions.wgId, wgId))
		.limit(1);
	return toVersions(row);
}

/**
 * The versions by share code, for the WG layout: read before the roster and the page's reads, so
 * anything written after them moves a version the first poll sees. Not access-checked; callers
 * hand the result out only after the membership check.
 */
export async function readWgChangeVersionsByShareCode(
	shareCode: string,
): Promise<WgChangeVersions> {
	const [row] = await db
		.select(versionColumns)
		.from(wgs)
		.leftJoin(wgChangeVersions, eq(wgChangeVersions.wgId, wgs.id))
		.where(eq(wgs.shareCode, shareCode))
		.limit(1);
	return toVersions(row);
}

import { eq } from 'drizzle-orm';
import { db } from './index';
import { wgChangeVersions } from './schema-change-versions';

/** `GET /api/wg/[code]/changes`: transaction ids as strings, compared for equality only. */
export interface WgChangeVersions {
	data: string;
	members: string;
	chat: string;
}

/** A WG's change versions; a WG nothing was written to yet has none and reads as all `'0'`. */
export async function readWgChangeVersions(wgId: string): Promise<WgChangeVersions> {
	const [row] = await db
		.select({
			data: wgChangeVersions.dataVersion,
			members: wgChangeVersions.membersVersion,
			chat: wgChangeVersions.chatVersion,
		})
		.from(wgChangeVersions)
		.where(eq(wgChangeVersions.wgId, wgId))
		.limit(1);
	return {
		data: String(row?.data ?? 0),
		members: String(row?.members ?? 0),
		chat: String(row?.chat ?? 0),
	};
}

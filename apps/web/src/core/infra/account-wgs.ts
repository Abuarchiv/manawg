import { apiFetch } from '@/core/infra/api-client';
import { isRecord } from '@/core/utils/is-record';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';

export interface AccountWg {
	id: string;
	code: string;
	name: string;
	/** The account's member in this WG; absent from answers that do not name it. */
	memberId?: string;
}

function isAccountWg(value: unknown): value is AccountWg {
	if (!isRecord(value)) return false;
	const id = value.id;
	const code = value.code;
	const name = value.name;
	return (
		typeof id === 'string' &&
		id.length > 0 &&
		typeof code === 'string' &&
		isValidShareCode(normalizeShareCode(code)) &&
		typeof name === 'string' &&
		name.trim().length > 0
	);
}

/** Validates the `/api/wg/mine` body; null when any entry is malformed. */
export function parseAccountWgs(value: unknown): AccountWg[] | null {
	if (!isRecord(value)) return null;
	const wgs = value.wgs;
	if (!Array.isArray(wgs) || !wgs.every(isAccountWg)) return null;
	return wgs.map((wg) => {
		// A missing or malformed memberId is dropped, never a reason to reject the list.
		const memberId = Reflect.get(wg, 'memberId');
		return {
			id: wg.id,
			code: normalizeShareCode(wg.code),
			name: wg.name.trim(),
			...(typeof memberId === 'string' && memberId.length > 0 ? { memberId } : {}),
		};
	});
}

/** The signed-in account's WGs. Status 401 means signed out; status 0 a network or invalid answer. */
export async function fetchAccountWgs(
	signal?: AbortSignal,
): Promise<{ ok: true; wgs: AccountWg[] } | { ok: false; status: number }> {
	const res = await apiFetch<unknown>('/api/wg/mine', signal ? { signal } : {});
	if (!res.ok) return { ok: false, status: res.status };
	const wgs = parseAccountWgs(res.data);
	return wgs ? { ok: true, wgs } : { ok: false, status: 0 };
}

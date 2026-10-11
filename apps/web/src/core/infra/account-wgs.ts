import { apiFetch } from '@/core/infra/api-client';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';

export interface AccountWg {
	id: string;
	code: string;
	name: string;
}

function isAccountWg(value: unknown): value is AccountWg {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const id = Reflect.get(value, 'id');
	const code = Reflect.get(value, 'code');
	const name = Reflect.get(value, 'name');
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
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const wgs = Reflect.get(value, 'wgs');
	if (!Array.isArray(wgs) || !wgs.every(isAccountWg)) return null;
	return wgs.map((wg) => ({
		id: wg.id,
		code: normalizeShareCode(wg.code),
		name: wg.name.trim(),
	}));
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

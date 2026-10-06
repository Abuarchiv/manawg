/** A plain object (not null, not an array), e.g. a parsed JSON body or stored payload. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

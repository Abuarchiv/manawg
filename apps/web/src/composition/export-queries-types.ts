/** Per-section paging. The sentinel means "no cap" for plain full dumps. */
export interface ExportPage {
	limit: number;
	offset: number;
}

export const NO_EXPORT_LIMIT = Number.MAX_SAFE_INTEGER;

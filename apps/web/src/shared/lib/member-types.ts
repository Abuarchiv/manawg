/** Name and color a member is rendered with. */
export interface MemberInfo {
	name: string;
	color: string | null;
}

/** Minimal member reference for pickers and split math. */
export interface MemberRef {
	id: string;
	name: string;
}

export function getChoreHighlightPath(choreId: string): string {
	return `/putzen?highlight=${encodeURIComponent(choreId)}`;
}

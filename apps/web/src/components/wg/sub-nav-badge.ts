/** Count/marker badge colour: the active tab's tinted dark background needs more contrast than muted text gives. */
export function subNavBadgeColor(active: boolean): string {
	return active ? 'text-foreground/80' : 'text-muted-foreground';
}

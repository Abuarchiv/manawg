interface MemberAvatarProps {
	name: string;
	color?: string | null;
	size?: number;
	className?: string;
}

const DEFAULT_SIZE = 28;
const HIDE_INITIALS_BELOW = 18;

function initials(name: string): string {
	// Split on whitespace AND hyphens so "Maximilian-Christopher von Hohenzollern-Sigmaringen"
	// yields "MS" (first+last word) consistently with hyphenated names.
	const parts = name
		.trim()
		.split(/[\s-]+/)
		.filter(Boolean);
	if (parts.length === 0) return '?';
	const first = parts[0] ?? '';
	if (parts.length === 1) return first.slice(0, 2).toUpperCase();
	const last = parts[parts.length - 1] ?? first;
	return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

export function MemberAvatar({ name, size = DEFAULT_SIZE, className = '' }: MemberAvatarProps) {
	const showInitials = size >= HIDE_INITIALS_BELOW;
	const fontSize = Math.round(size * 0.42);

	return (
		<span
			aria-hidden
			className={`inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted font-medium text-foreground ${className}`}
			style={{
				width: size,
				height: size,
				fontSize,
			}}
		>
			{showInitials ? initials(name) : null}
		</span>
	);
}

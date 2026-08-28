interface MemberAvatarProps {
	name: string;
	color?: string | null;
	size?: number;
	className?: string;
}

const DEFAULT_SIZE = 28;
const HIDE_INITIALS_BELOW = 18;
const PALETTE = ['#5a6660', '#6b8e5d', '#4a5d6b', '#7d8a76', '#345c47', '#7d8a4d'];

function hashCode(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h << 5) - h + s.charCodeAt(i);
		h |= 0;
	}
	return Math.abs(h);
}

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

export function MemberAvatar({
	name,
	color,
	size = DEFAULT_SIZE,
	className = '',
}: MemberAvatarProps) {
	const safeColor = color && color.length > 0 ? color : null;
	const resolved = safeColor ?? PALETTE[hashCode(name) % PALETTE.length] ?? '#5a6660';
	const showInitials = size >= HIDE_INITIALS_BELOW;
	const fontSize = Math.round(size * 0.42);

	return (
		<span
			aria-hidden
			className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ${className}`}
			style={{
				width: size,
				height: size,
				fontSize,
				background: resolved,
			}}
		>
			{showInitials ? initials(name) : null}
		</span>
	);
}

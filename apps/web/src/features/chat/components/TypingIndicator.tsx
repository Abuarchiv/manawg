'use client';

interface TypingIndicatorProps {
	names: string[];
}

export function TypingIndicator({ names }: TypingIndicatorProps) {
	if (names.length === 0) return null;
	const text = names.length === 1 ? `${names[0]} tippt …` : `${names.length} tippen …`;
	return (
		<div
			className="absolute bottom-0 left-0 bg-background/80 px-3 py-1 text-xs text-muted-foreground"
			aria-live="polite"
			aria-atomic="true"
		>
			{text}
		</div>
	);
}

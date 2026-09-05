'use client';

interface TypingIndicatorProps {
	names: string[];
}

export function TypingIndicator({ names }: TypingIndicatorProps) {
	if (names.length === 0) return null;
	const text = names.length === 1 ? `${names[0]} tippt` : `${names.length} tippen`;
	return (
		<div
			className="absolute bottom-0 left-0 flex items-center gap-1 bg-background/80 px-3 py-1 text-[11px] text-muted-foreground"
			aria-live="polite"
			aria-atomic="true"
		>
			<span>{text}</span>
			<span
				className="inline-block h-1 w-1 animate-bounce rounded-full bg-current motion-reduce:animate-none"
				style={{ animationDelay: '0ms' }}
			/>
			<span
				className="inline-block h-1 w-1 animate-bounce rounded-full bg-current motion-reduce:animate-none"
				style={{ animationDelay: '120ms' }}
			/>
			<span
				className="inline-block h-1 w-1 animate-bounce rounded-full bg-current motion-reduce:animate-none"
				style={{ animationDelay: '240ms' }}
			/>
		</div>
	);
}

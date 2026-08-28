// craftsman-ignore: TS002 — Next.js App Router requires default export from loading.tsx
import { Loader2 } from 'lucide-react';

export default function ChatLoading() {
	return (
		<div className="flex min-h-[calc(100svh-4.25rem)] items-center justify-center px-4">
			<div className="flex flex-col items-center gap-3 text-[var(--text-3)]">
				<Loader2 className="h-6 w-6 animate-spin" aria-hidden />
				<span className="text-[13px]">Chat wird geladen…</span>
			</div>
		</div>
	);
}

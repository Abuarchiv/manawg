'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/shared/lib/cn';

export type ActionNoticeTone = 'error' | 'warning' | 'success';

export interface ActionNotice {
	message: string;
	tone: ActionNoticeTone;
}

const TONE_CLASSES: Record<ActionNoticeTone, string> = {
	success: 'border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-fg)]',
	warning: 'border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-fg)]',
	error: '',
};

export function ActionNoticeBanner({ notice }: { notice: ActionNotice }) {
	return (
		<Alert
			variant={notice.tone === 'error' ? 'destructive' : 'default'}
			role={notice.tone === 'error' ? 'alert' : 'status'}
			aria-live={notice.tone === 'error' ? undefined : 'polite'}
			className={cn(TONE_CLASSES[notice.tone])}
		>
			<AlertDescription className="text-current">{notice.message}</AlertDescription>
		</Alert>
	);
}

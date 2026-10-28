import { Alert, AlertDescription } from '@/components/ui/alert';

export type RowNoticeState = { kind: 'sent' | 'error'; text: string } | null;

/** Inline result message shared by the account rows in the settings. */
export function RowNotice({ notice }: { notice: RowNoticeState }) {
	if (!notice) return null;
	return (
		<Alert variant={notice.kind === 'error' ? 'destructive' : 'default'}>
			<AlertDescription>{notice.text}</AlertDescription>
		</Alert>
	);
}

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ChatBanner({
	message,
	actionLabel,
	onAction,
}: {
	message: string;
	actionLabel: string;
	onAction: () => void;
}) {
	return (
		<Alert variant="destructive" className="rounded-none border-x-0 border-t-0 px-4 py-1.5">
			<AlertDescription className="flex flex-row flex-wrap items-center justify-between gap-x-2 gap-y-0 text-xs">
				{message}
				<Button variant="ghost" size="sm" className="text-xs" onClick={onAction}>
					{actionLabel}
				</Button>
			</AlertDescription>
		</Alert>
	);
}

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
			<AlertDescription className="flex flex-row flex-nowrap items-start justify-between gap-x-2 gap-y-0 text-xs">
				<span className="min-w-0 flex-1">{message}</span>
				<Button variant="ghost" size="sm" className="-mx-2 shrink-0 text-xs" onClick={onAction}>
					{actionLabel}
				</Button>
			</AlertDescription>
		</Alert>
	);
}

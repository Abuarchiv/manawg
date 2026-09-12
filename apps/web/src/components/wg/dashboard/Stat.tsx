import { cn } from '@/shared/lib/cn';

interface StatProps {
	label: string;
	value: string;
	sub?: string;
	subTone?: 'danger' | 'neutral';
	tone?: 'positive' | 'negative' | 'neutral';
}
export function Stat({ label, value, sub, subTone = 'neutral', tone = 'neutral' }: StatProps) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd
				className={cn(
					'break-words text-lg font-semibold tabular-nums',
					tone === 'negative' && 'text-destructive',
				)}
			>
				{value}
			</dd>
			{sub && (
				<dd
					className={cn(
						'text-sm text-muted-foreground',
						subTone === 'danger' && 'text-destructive',
					)}
				>
					{sub}
				</dd>
			)}
		</div>
	);
}

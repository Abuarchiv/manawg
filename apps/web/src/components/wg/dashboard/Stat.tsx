interface StatProps {
	label: string;
	value: string;
	sub?: string | undefined;
	subTone?: 'danger' | 'neutral';
	tone?: 'positive' | 'negative' | 'neutral';
}

export function Stat({ label, value, sub, subTone = 'neutral', tone = 'neutral' }: StatProps) {
	const valueColor =
		tone === 'positive'
			? 'text-[var(--accent)]'
			: tone === 'negative'
				? 'text-[var(--danger)]'
				: 'text-[var(--text-1)]';
	const subColor = subTone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--text-3)]';
	return (
		<div className="min-w-0 px-2.5 py-4 sm:px-4">
			<dt className="truncate text-[11.5px] text-[var(--text-3)] sm:text-[12.5px]">{label}</dt>
			<dd
				className={`mt-1 truncate text-[14px] font-semibold tabular-nums tracking-tight sm:text-[20px] ${valueColor}`}
			>
				{value}
			</dd>
			{sub && <p className={`mt-0.5 truncate text-[11px] ${subColor}`}>{sub}</p>}
		</div>
	);
}

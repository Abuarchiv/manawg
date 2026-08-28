'use client';

interface FieldProps {
	id: string;
	label: string;
	placeholder?: string;
	value: string;
	onChange: (v: string) => void;
	maxLength: number;
	autoComplete?: string;
}

export function Field({
	id,
	label,
	placeholder,
	value,
	onChange,
	maxLength,
	autoComplete,
}: FieldProps) {
	const nearLimit = value.length >= maxLength - 8;
	return (
		<div>
			<div className="mb-1.5 flex items-baseline justify-between gap-2">
				<label htmlFor={id} className="block text-[13px] font-medium text-[var(--text-1)]">
					{label}
				</label>
				{nearLimit && (
					<span
						aria-live="polite"
						className={`text-[11px] tabular-nums ${
							value.length >= maxLength ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'
						}`}
					>
						{value.length}/{maxLength}
					</span>
				)}
			</div>
			<input
				id={id}
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				maxLength={maxLength}
				placeholder={placeholder}
				autoComplete={autoComplete}
				className="block h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-base)] px-3.5 text-base text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-all duration-200 focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
			/>
		</div>
	);
}

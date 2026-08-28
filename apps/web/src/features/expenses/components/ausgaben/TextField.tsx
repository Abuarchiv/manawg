'use client';

interface TextFieldProps {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	maxLength?: number;
	inputMode?: 'text' | 'decimal' | 'numeric';
	suffix?: string;
	disabled?: boolean;
}

export function TextField({
	label,
	value,
	onChange,
	placeholder,
	maxLength,
	inputMode = 'text',
	suffix,
	disabled = false,
}: TextFieldProps) {
	const id = `f-${label.toLowerCase().replace(/\s+/g, '-')}`;
	return (
		<div>
			<label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]">
				{label}
			</label>
			<div className="relative">
				<input
					id={id}
					type="text"
					inputMode={inputMode}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					maxLength={maxLength}
					placeholder={placeholder}
					disabled={disabled}
					className={`block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
						suffix ? 'pr-8' : ''
					} ${inputMode === 'decimal' ? 'tabular-nums' : ''} disabled:cursor-not-allowed disabled:opacity-70`}
				/>
				{suffix && (
					<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-3)]">
						{suffix}
					</span>
				)}
			</div>
		</div>
	);
}

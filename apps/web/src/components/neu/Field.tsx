'use client';

import { FieldLabel, Field as FieldPrimitive } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/shared/lib/cn';

interface FieldProps {
	id: string;
	label: string;
	placeholder?: string;
	value: string;
	onChange: (v: string) => void;
	maxLength: number;
	autoComplete?: string;
	invalid?: boolean;
	describedBy?: string | undefined;
}

export function Field({
	id,
	label,
	placeholder,
	value,
	onChange,
	maxLength,
	autoComplete,
	invalid = false,
	describedBy,
}: FieldProps) {
	const nearLimit = value.length >= maxLength - 8;
	const describedByProps = describedBy === undefined ? {} : { 'aria-describedby': describedBy };
	return (
		<FieldPrimitive data-invalid={invalid}>
			<div className="flex items-baseline justify-between gap-2">
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				{nearLimit && (
					<span
						aria-live="polite"
						className={cn(
							'text-xs tabular-nums',
							value.length >= maxLength ? 'text-destructive' : 'text-muted-foreground',
						)}
					>
						{value.length}/{maxLength}
					</span>
				)}
			</div>
			<Input
				id={id}
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				maxLength={maxLength}
				placeholder={placeholder}
				autoComplete={autoComplete}
				aria-invalid={invalid}
				{...describedByProps}
				className="min-h-11 text-base md:text-base"
			/>
		</FieldPrimitive>
	);
}

'use client';

import { Field, FieldLabel } from '@/components/ui/field';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from '@/components/ui/input-group';

interface TextFieldProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
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
		<Field data-disabled={disabled}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<InputGroup className="min-h-11">
				<InputGroupInput
					id={id}
					type="text"
					inputMode={inputMode}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					maxLength={maxLength}
					placeholder={placeholder}
					disabled={disabled}
					className="min-h-11 text-base md:text-base"
				/>
				{suffix && (
					<InputGroupAddon align="inline-end">
						<InputGroupText>{suffix}</InputGroupText>
					</InputGroupAddon>
				)}
			</InputGroup>
		</Field>
	);
}

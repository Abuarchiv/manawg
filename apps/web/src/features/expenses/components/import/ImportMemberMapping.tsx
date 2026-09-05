'use client';

import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

interface MemberOption {
	id: string;
	name: string;
}

interface Props {
	names: readonly string[];
	mapping: Readonly<Record<string, string | null>>;
	members: readonly MemberOption[];
	onChange: (name: string, memberId: string | null) => void;
}

export function ImportMemberMapping({ names, mapping, members, onChange }: Props) {
	if (names.length === 0)
		return <p className="text-sm text-muted-foreground">Keine Namen erkannt.</p>;
	return (
		<FieldGroup>
			{names.map((name, index) => {
				const value = mapping[name] ?? '';
				return (
					<Field key={name} data-invalid={!value}>
						<FieldLabel htmlFor={`import-map-${index}`}>{name}</FieldLabel>
						<NativeSelect
							id={`import-map-${index}`}
							value={value}
							onChange={(event) => onChange(name, event.target.value || null)}
							aria-label={`Mitglied für ${name} wählen`}
							aria-invalid={!value}
							aria-describedby={!value ? `import-map-error-${index}` : undefined}
							className="w-full [&_select]:h-11 [&_select]:text-base"
						>
							<NativeSelectOption value="">WG-Mitglied auswählen</NativeSelectOption>
							{members.map((member) => (
								<NativeSelectOption key={member.id} value={member.id}>
									{member.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
						{!value && (
							<FieldError id={`import-map-error-${index}`}>Bitte WG-Mitglied auswählen.</FieldError>
						)}
					</Field>
				);
			})}
		</FieldGroup>
	);
}

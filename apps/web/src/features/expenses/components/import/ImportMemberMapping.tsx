'use client';

import { Badge } from '@/components/ui/badge';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { UNKNOWN_NAME } from '@/features/expenses/import-parsers';
import { useTranslations } from 'next-intl';
import { SKIP_NAME } from './import-wizard-types';

interface MemberOption {
	id: string;
	name: string;
}

interface Props {
	names: readonly string[];
	mapping: Readonly<Record<string, string | null>>;
	members: readonly MemberOption[];
	onChange: (name: string, memberId: string | null) => void;
	showErrors?: boolean;
	/** Names the server matched by similarity only. */
	suggestedNames?: readonly string[];
}

export function ImportMemberMapping({
	names,
	mapping,
	members,
	onChange,
	showErrors = false,
	suggestedNames = [],
}: Props) {
	const t = useTranslations('expenses-import.mapping');
	const tCommon = useTranslations('common');
	if (names.length === 0) return <p className="text-sm text-muted-foreground">{t('noNames')}</p>;
	return (
		<FieldGroup>
			{names.map((name, index) => {
				const mapped = mapping[name];
				// A stale id (e.g. a moved-out member) is shown as unassigned and flagged.
				const value =
					mapped === SKIP_NAME || (mapped && members.some((member) => member.id === mapped))
						? mapped
						: '';
				const invalid = showErrors && !value;
				const shownName = name === UNKNOWN_NAME ? tCommon('unknownPerson') : name;
				return (
					<Field key={name} data-invalid={invalid || undefined}>
						<FieldLabel htmlFor={`import-map-${index}`}>
							{shownName}
							{value && value !== SKIP_NAME && suggestedNames.includes(name) && (
								<Badge variant="secondary">{t('suggestion')}</Badge>
							)}
						</FieldLabel>
						<NativeSelect
							id={`import-map-${index}`}
							value={value}
							onChange={(event) => onChange(name, event.target.value || null)}
							aria-label={t('selectAria', { name: shownName })}
							aria-invalid={invalid || undefined}
							aria-describedby={invalid ? `import-map-error-${index}` : undefined}
							className="w-full"
						>
							<NativeSelectOption value="">{t('unassigned')}</NativeSelectOption>
							{members.map((member) => (
								<NativeSelectOption key={member.id} value={member.id}>
									{member.name}
								</NativeSelectOption>
							))}
							<NativeSelectOption value={SKIP_NAME}>{t('skip')}</NativeSelectOption>
						</NativeSelect>
						{value === SKIP_NAME && (
							<FieldDescription>{t('skipHint', { name: shownName })}</FieldDescription>
						)}
						{invalid && <FieldError id={`import-map-error-${index}`}>{t('required')}</FieldError>}
					</Field>
				);
			})}
		</FieldGroup>
	);
}

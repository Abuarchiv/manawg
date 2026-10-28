'use client';

import { FileText, FileUp, Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export type ImportSourceKind = 'splitwise_csv' | 'splid_csv' | 'ocr_screenshot';

interface Props {
	value: ImportSourceKind | null;
	onChange: (value: ImportSourceKind) => void;
}

const OPTIONS: ReadonlyArray<{
	id: ImportSourceKind;
	text: 'splitwise' | 'splid' | 'screenshot';
	icon: typeof FileText;
}> = [
	{ id: 'splitwise_csv', text: 'splitwise', icon: FileText },
	{ id: 'splid_csv', text: 'splid', icon: FileUp },
	{ id: 'ocr_screenshot', text: 'screenshot', icon: ImageIcon },
];

export function ImportSourcePicker({ value, onChange }: Props) {
	const t = useTranslations('expenses-import.source');
	return (
		<FieldSet>
			<FieldLegend className="sr-only">{t('heading')}</FieldLegend>
			<ToggleGroup
				value={value ? [value] : []}
				orientation="vertical"
				variant="outline"
				className="w-full min-w-0"
			>
				{OPTIONS.map(({ id, text, icon: Icon }) => (
					<ToggleGroupItem
						key={id}
						value={id}
						// onClick instead of onValueChange: tapping the selected source again yields an empty list there.
						onClick={() => onChange(id)}
						className="h-auto min-h-16 w-full min-w-0 justify-start gap-3 whitespace-normal py-3 text-left"
					>
						<Icon />
						<span className="min-w-0 flex-1 break-words">
							<span className="block">{t(`${text}.title`)}</span>
							<span className="block text-xs text-muted-foreground">{t(`${text}.hint`)}</span>
						</span>
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</FieldSet>
	);
}

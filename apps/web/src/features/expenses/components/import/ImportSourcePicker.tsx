'use client';

import { FieldLegend, FieldSet } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FileText, FileUp, Image as ImageIcon } from 'lucide-react';

export type ImportSourceKind = 'splitwise_csv' | 'splid_csv' | 'ocr_screenshot';

interface Props {
	value: ImportSourceKind | null;
	onChange: (value: ImportSourceKind) => void;
}

const OPTIONS: ReadonlyArray<{
	id: ImportSourceKind;
	title: string;
	hint: string;
	icon: typeof FileText;
}> = [
	{
		id: 'splitwise_csv',
		title: 'Splitwise CSV',
		hint: 'Datei aus Splitwise',
		icon: FileText,
	},
	{
		id: 'splid_csv',
		title: 'Splid CSV',
		hint: 'Datei aus Splid',
		icon: FileUp,
	},
	{
		id: 'ocr_screenshot',
		title: 'Screenshot',
		hint: 'Foto oder Bildschirmfoto',
		icon: ImageIcon,
	},
];

export function ImportSourcePicker({ value, onChange }: Props) {
	return (
		<FieldSet>
			<FieldLegend className="sr-only">Importquelle wählen</FieldLegend>
			<ToggleGroup
				value={value ? [value] : []}
				orientation="vertical"
				variant="outline"
				className="w-full min-w-0"
			>
				{OPTIONS.map(({ id, title, hint, icon: Icon }) => (
					<ToggleGroupItem
						key={id}
						value={id}
						// onClick instead of onValueChange: tapping the selected source again yields an empty list there.
						onClick={() => onChange(id)}
						className="h-auto min-h-16 w-full min-w-0 justify-start gap-3 whitespace-normal py-3 text-left"
					>
						<Icon />
						<span className="min-w-0 flex-1 break-words">
							<span className="block">{title}</span>
							<span className="block text-xs text-muted-foreground">{hint}</span>
						</span>
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</FieldSet>
	);
}

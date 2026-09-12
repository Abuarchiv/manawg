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
		hint: 'Export aus Splitwise (Date,Description,Cost,...)',
		icon: FileText,
	},
	{
		id: 'splid_csv',
		title: 'Splid CSV',
		hint: 'Export aus Splid (Datum;Beschreibung;Betrag;...)',
		icon: FileUp,
	},
	{
		id: 'ocr_screenshot',
		title: 'Screenshot',
		hint: 'Foto oder Screenshot aus Splitwise/Splid (OCR)',
		icon: ImageIcon,
	},
];

export function ImportSourcePicker({ value, onChange }: Props) {
	return (
		<FieldSet>
			<FieldLegend>Importquelle wählen</FieldLegend>
			<ToggleGroup
				value={value ? [value] : []}
				onValueChange={(values) => {
					const next = values[0];
					if (next === 'splitwise_csv' || next === 'splid_csv' || next === 'ocr_screenshot')
						onChange(next);
				}}
				orientation="vertical"
				variant="outline"
				className="w-full"
			>
				{OPTIONS.map(({ id, title, hint, icon: Icon }) => (
					<ToggleGroupItem
						key={id}
						value={id}
						className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal py-3 text-left"
					>
						<Icon />
						<span className="min-w-0">
							<span className="block">{title}</span>
							<span className="block text-xs text-muted-foreground">{hint}</span>
						</span>
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</FieldSet>
	);
}

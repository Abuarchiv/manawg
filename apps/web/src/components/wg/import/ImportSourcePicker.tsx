'use client';

import { Check, FileText, FileUp, Image as ImageIcon } from 'lucide-react';

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
		<fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-3">
			<legend className="sr-only">Importquelle wählen</legend>
			{OPTIONS.map((option) => {
				const Icon = option.icon;
				const active = value === option.id;
				return (
					<button
						key={option.id}
						type="button"
						onClick={() => onChange(option.id)}
						aria-pressed={active}
						className={`relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
							active
								? 'border-[var(--accent)] bg-[var(--accent)]/10'
								: 'border-[var(--border)] hover:border-[var(--border-strong)]'
						}`}
					>
						{active && (
							<Check className="absolute right-3 top-3 h-4 w-4 text-[var(--accent)]" aria-hidden />
						)}
						<Icon className="h-5 w-5 text-[var(--text-2)]" aria-hidden />
						<div>
							<div className="text-[14px] font-medium text-[var(--text-1)]">{option.title}</div>
							<div className="mt-0.5 text-[12px] text-[var(--text-3)]">{option.hint}</div>
						</div>
					</button>
				);
			})}
		</fieldset>
	);
}

'use client';

import { ImportWizard } from '@/features/expenses/components/import/ImportWizard';

export default function ImportPage() {
	return (
		<div
			data-finance-content
			className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4 px-4 py-4"
		>
			<ImportWizard />
		</div>
	);
}
